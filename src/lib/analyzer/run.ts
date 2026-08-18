import { computeConfluence } from "./confluence";
import { buildHtfModel, htfContextAt } from "./htf";
import { sessionContextFor } from "./session-context";
import { evaluateStaleness } from "./staleness";
import { ema, sessionBlocks } from "./indicators";
import { applySpreadAndRR, RR_FAIL_REASON, RR_THRESHOLD } from "./math";
import { parseCsv, parseSpread } from "./parse";
import { evaluateSetupStatus, isLive } from "./status";
import { STRATEGIES } from "./strategies";
import { buildIndex, computeMarketStructure } from "./structure";
import type {
  Analysis,
  AnalysisContext,
  OverlapEntry,
  ResultRow,
} from "./types";

export interface RunFailure {
  ok: false;
  error: string;
}

export interface RunSuccess {
  ok: true;
  analysis: Analysis;
}

export type RunOutcome = RunSuccess | RunFailure;

export interface ProgressEvent {
  /** 0-100 */
  percent: number;
  message: string;
}

export type ProgressFn = (event: ProgressEvent) => void;

/**
 * The pipeline as a generator: it yields progress events between phases (and
 * between row batches) so callers can either drain it synchronously or await
 * between yields to keep the UI responsive.
 */
export function* analysisSteps(text: string): Generator<ProgressEvent, RunOutcome, void> {
  yield { percent: 2, message: `Parsing CSV (${text.length.toLocaleString()} chars)…` };
  const parsed = parseCsv(text);
  if (!parsed.meta) {
    return { ok: false, error: parsed.metadataError ?? "INVALID FILE: metadata header missing" };
  }

  const candles = parsed.candles;
  if (candles.length === 0) {
    return { ok: false, error: "INVALID FILE: no data rows found after the header" };
  }
  yield {
    percent: 8,
    message: `Metadata OK · ${candles.length.toLocaleString()} candle rows parsed`,
  };

  const byDatetime = buildIndex(candles);
  computeMarketStructure(candles, byDatetime);
  yield { percent: 15, message: "Market structure computed from resolved swing references" };

  const ctx: AnalysisContext = {
    meta: parsed.meta,
    candles,
    byDatetime,
    ema50: ema(candles, 50),
    ema200: ema(candles, 200),
    blocks: sessionBlocks(candles),
    spread: parseSpread(parsed.meta.spread_convention),
  };
  yield {
    percent: 20,
    message: `Indicators ready · EMA 50/200, ${ctx.blocks.length} session blocks, spread ${ctx.spread}`,
  };

  const results: ResultRow[] = [];
  const invalidRowList: { datetime: string; reason: string }[] = [];

  const BATCH = 200;
  let processed = 0;
  for (const candle of candles) {
    if (candle.invalid) {
      invalidRowList.push({ datetime: candle.datetime, reason: candle.invalid });
      processed++;
      continue;
    }
    for (const strategy of STRATEGIES) {
      const outcome = strategy.run(ctx, candle.index);
      const row: ResultRow = {
        strategyId: strategy.id,
        strategy: strategy.name,
        index: candle.index,
        datetime: candle.datetime,
        result: outcome.result,
        reason: outcome.reason,
        trend: candle.trend,
        side: outcome.side,
      };

      if (outcome.result === "PASS") {
        // Step 4: spread + RR are applied only to PASS results.
        const math = applySpreadAndRR(outcome, ctx.spread);
        if (!math) {
          row.result = "FAIL";
          row.reason = "missing entry/SL/TP price from source rows";
        } else {
          row.entry = math.entry;
          row.sl = math.sl;
          row.tp = math.tp;
          if (math.invalidReason || math.rr === undefined) {
            // No RR at all when risk is non-positive; never report a faked positive.
            row.rr = undefined;
            row.result = "FAIL";
            row.reason = math.invalidReason ?? "INVALID: RR not computable";
          } else {
            row.rr = math.rr;
            if (math.rr <= RR_THRESHOLD) {
            row.result = "FAIL";
            row.reason = RR_FAIL_REASON;
            }
          }
        }
      }

      results.push(row);
    }

    processed++;
    if (processed % BATCH === 0 || processed === candles.length) {
      yield {
        percent: 20 + Math.round((processed / candles.length) * 65),
        message: `Checked ${processed.toLocaleString()}/${candles.length.toLocaleString()} candles × ${STRATEGIES.length} strategies`,
      };
    }
  }

  yield { percent: 88, message: "Aggregating per-strategy pass/fail reasons…" };
  const perStrategy = STRATEGIES.map((strategy) => {
    const rows = results.filter((r) => r.strategyId === strategy.id);
    const reasons = new Map<string, number>();
    for (const row of rows) {
      if (row.result === "FAIL") reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    }
    return {
      strategyId: strategy.id,
      strategy: strategy.name,
      passCount: rows.filter((r) => r.result === "PASS").length,
      failCount: rows.filter((r) => r.result === "FAIL").length,
      failReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    };
  });

  const passing = results
    .filter((r) => r.result === "PASS")
    .sort((a, b) => (b.rr ?? 0) - (a.rr ?? 0));

  yield {
    percent: 92,
    message: `${passing.length} PASS setups · forward-checking status against later candles…`,
  };
  // Step 6: forward-check each PASS against later candles ("now" = last row).
  for (const row of passing) {
    const evaluation = evaluateSetupStatus(row, candles);
    row.setupStatus = evaluation.setupStatus;
    row.statusNote = evaluation.statusNote;
    row.candlesSinceTrigger = evaluation.candlesSinceTrigger;
  }

  yield {
    percent: 94,
    message: "Computing context fields (ATR, confluence, HTF trend, session, staleness)…",
  };
  // Context only: these never flip result or setupStatus, they add ranking signal.
  const htfModel = buildHtfModel(candles);
  for (const row of passing) {
    const candle = byDatetime.get(row.datetime.trim()) ?? candles[row.index];
    if (!candle) continue;
    row.atr30m = candle.atr30m;
    if (row.entry !== undefined) row.confluence = computeConfluence(ctx, candle, row.entry);
    row.htf = htfContextAt(htfModel, row.index, row.side);
    row.sessionContext = sessionContextFor(candles, ctx.blocks, candle);
    const staleness = evaluateStaleness(row, candles);
    row.stalenessFlag = staleness.flag;
    row.stalenessReason = staleness.reason;
  }

  const statusRank: Record<string, number> = { PENDING: 0, FILLED: 1 };
  const live = passing
    .filter((r) => isLive(r.setupStatus))
    .sort(
      (a, b) =>
        (statusRank[a.setupStatus ?? ""] ?? 9) - (statusRank[b.setupStatus ?? ""] ?? 9) ||
        (b.rr ?? 0) - (a.rr ?? 0),
    );
  const historical = passing.filter((r) => !isLive(r.setupStatus));
  yield {
    percent: 96,
    message: `${live.length} live/actionable · ${historical.length} historical`,
  };

  const overlapMap = new Map<string, string[]>();
  for (const row of live) {
    const list = overlapMap.get(row.datetime) ?? [];
    list.push(row.strategy);
    overlapMap.set(row.datetime, list);
  }
  const overlaps: OverlapEntry[] = [...overlapMap.entries()]
    .filter(([, strategies]) => strategies.length > 1)
    .map(([datetime, strategies]) => ({ datetime, strategies: [...strategies].sort() }))
    .sort((a, b) => a.datetime.localeCompare(b.datetime));

  const analysis: Analysis = {
    meta: parsed.meta,
    spread: ctx.spread,
    totalRows: parsed.totalRows,
    analyzedRows: candles.length - invalidRowList.length,
    invalidRows: invalidRowList.length,
    invalidRowList,
    results,
    passing,
    live,
    historical,
    perStrategy,
    overlaps,
    lastRowDatetime: candles[candles.length - 1]?.datetime ?? "",
  };

  yield { percent: 100, message: "Analysis complete" };
  return { ok: true, analysis };
}

/** Synchronous run (tests, exports). Drains the generator immediately. */
export function runAnalysis(text: string, onProgress?: ProgressFn): RunOutcome {
  const steps = analysisSteps(text);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onProgress?.(next.value);
  }
}

/**
 * Browser run: yields back to the event loop between batches so the progress bar
 * and console actually paint while a large CSV is being analysed.
 */
export async function runAnalysisAsync(
  text: string,
  onProgress?: ProgressFn,
): Promise<RunOutcome> {
  const steps = analysisSteps(text);
  let lastPaint = 0;
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onProgress?.(next.value);
    const now = Date.now();
    if (now - lastPaint > 30) {
      lastPaint = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}
