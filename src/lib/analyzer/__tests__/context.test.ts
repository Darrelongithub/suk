import { describe, expect, it } from "vitest";

import { computeConfluence, roundNumberNear } from "../confluence";
import { aggregate, buildHtfModel, htfContextAt, identifyTrend } from "../htf";
import { sessionContextFor } from "../session-context";
import { evaluateStaleness } from "../staleness";
import { BULL_REFS, BULL_SWINGS, dtFor, makeCtx, type RowSpec } from "./helpers";
import type { ResultRow } from "../types";

function ctxWith(extra: RowSpec[]) {
  return makeCtx([...BULL_SWINGS, ...extra]);
}

describe("HTF aggregation", () => {
  it("aggregates 30m candles into H1 with max high, min low, last close", () => {
    const ctx = ctxWith([]);
    const h1 = aggregate(ctx.candles, "H1");
    expect(h1[0]!.high).toBe(101);
    expect(h1[0]!.low).toBe(99);
    expect(h1[0]!.close).toBe(100.8);
  });

  it("identifyTrend reuses trendFrom semantics", () => {
    expect(
      identifyTrend([
        { key: "a", timeframe: "H1", endIndex: 0, high: 1, low: 0.5, close: 0.9 },
        { key: "b", timeframe: "H1", endIndex: 1, high: 2, low: 1.5, close: 1.9 },
      ]),
    ).toBe("bullish");
  });

  it("reports counter-trend without failing the setup", () => {
    const ctx = ctxWith([]);
    const model = buildHtfModel(ctx.candles);
    const context = htfContextAt(model, ctx.candles.length - 1, "short");
    expect(["aligned", "counter", "neutral"]).toContain(context.h1Alignment);
  });
});

describe("confluence", () => {
  it("returns an x/5 score and matched factor names", () => {
    const ctx = ctxWith([{ o: 101.5, h: 102, l: 101, c: 101.8, refs: BULL_REFS }]);
    const candle = ctx.candles[3]!;
    const result = computeConfluence(ctx, candle, 102);
    expect(result.total).toBe(5);
    expect(result.score).toBe(`${result.count}/5`);
    expect(result.matched).toContain("prior_swing");
  });

  it("rounds to a sensible round-number step", () => {
    expect(roundNumberNear(101.234)).toBeCloseTo(101.23, 5);
  });
});

describe("session context", () => {
  it("reports the Asian range and London/NY open direction", () => {
    const ctx = makeCtx([
      { o: 99.5, h: 100, l: 99, c: 99.8, session: "asian" },
      { o: 99.8, h: 100.5, l: 99.4, c: 100.2, session: "asian" },
      { o: 100.2, h: 101, l: 100, c: 100.9, session: "london" },
      { o: 100.9, h: 101.5, l: 100.5, c: 100.6, session: "new york" },
    ]);
    const context = sessionContextFor(ctx.candles, ctx.blocks, ctx.candles[3]!);
    expect(context.asianHigh).toBe(100.5);
    expect(context.asianLow).toBe(99);
    expect(context.londonOpenDirection.startsWith("up")).toBe(true);
    expect(context.nyOpenDirection.startsWith("down")).toBe(true);
  });
});

describe("staleness", () => {
  const row = (over: Partial<ResultRow> = {}): ResultRow => ({
    strategyId: "s",
    strategy: "S",
    index: 0,
    datetime: dtFor(0),
    result: "PASS",
    reason: "ok",
    trend: "bullish",
    side: "long",
    entry: 100,
    sl: 99,
    tp: 103,
    ...over,
  });

  it("flags tight consolidation near entry as Stale", () => {
    const specs: RowSpec[] = Array.from({ length: 10 }, () => ({
      o: 100,
      h: 100.05,
      l: 99.95,
      c: 100,
    }));
    const ctx = makeCtx(specs);
    const result = evaluateStaleness(row(), ctx.candles);
    expect(result.flag).toBe("Stale");
    expect(result.reason).toMatch(/momentum faded/);
  });

  it("is Fresh right after the trigger", () => {
    const ctx = makeCtx([
      { o: 100, h: 100.5, l: 99.5, c: 100.2 },
      { o: 100.2, h: 104, l: 100, c: 103.5 },
    ]);
    expect(evaluateStaleness(row(), ctx.candles).flag).toBe("Fresh");
  });
});
