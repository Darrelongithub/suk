import type { Candle, ResultRow } from "./types";

export type StalenessFlag = "Fresh" | "Aging" | "Stale";

export interface StalenessEvaluation {
  flag: StalenessFlag;
  reason: string;
}

export interface StalenessOptions {
  /** Candles after which an unfilled setup starts aging. */
  agingAfter?: number;
  /** Candles of tight consolidation near entry that mark momentum as faded. */
  consolidationCandles?: number;
  /** Candles after which an untouched setup is considered stale outright. */
  staleAfter?: number;
}

export const STALENESS_DEFAULTS: Required<StalenessOptions> = {
  agingAfter: 6,
  consolidationCandles: 8,
  staleAfter: 14,
};

/**
 * Real-time freshness, distinct from `status.ts`.
 *
 * status.ts answers "did this setup already resolve historically?".
 * This answers "as of the most recent candle, is this still worth acting on?" —
 * momentum fading (tight consolidation near entry) or newer opposing structure
 * forming nearby since the trigger.
 *
 * It never changes `setup_status`: a PENDING setup can be PENDING and Stale.
 */
export function evaluateStaleness(
  row: ResultRow,
  candles: Candle[],
  options: StalenessOptions = {},
): StalenessEvaluation {
  const opts = { ...STALENESS_DEFAULTS, ...options };
  const forward = candles.filter((c) => c.index > row.index && !c.invalid);
  const bars = forward.length;

  if (bars === 0) return { flag: "Fresh", reason: "triggered on the most recent candle" };
  if (row.entry === undefined) {
    return { flag: "Fresh", reason: "no entry price to measure movement against" };
  }

  const entry = row.entry;
  const atr = candles[row.index]?.atr30m;
  const band = atr !== undefined && atr > 0 ? atr * 0.5 : Math.abs(entry) * 0.0015;

  // 1. Momentum fading: many consecutive recent candles coiled tightly near entry.
  const recent = forward.slice(-opts.consolidationCandles);
  const coiled =
    recent.length >= opts.consolidationCandles &&
    recent.every(
      (c) =>
        c.high !== undefined &&
        c.low !== undefined &&
        Math.abs(c.high - entry) <= band &&
        Math.abs(c.low - entry) <= band,
    );
  if (coiled) {
    return {
      flag: "Stale",
      reason: `price coiled within ±${band.toFixed(5)} of entry for the last ${recent.length} candles — momentum faded`,
    };
  }

  // 2. Newer opposing structure formed nearby since the trigger.
  const opposing = forward.find((c) => {
    if (c.high === undefined || c.low === undefined) return false;
    const nearEntry = Math.abs((c.high + c.low) / 2 - entry) <= band * 3;
    if (!nearEntry) return false;
    if (row.side === "long") return c.trend === "bearish";
    if (row.side === "short") return c.trend === "bullish";
    return false;
  });
  if (opposing) {
    return {
      flag: "Stale",
      reason: `opposing ${opposing.trend} structure formed near entry at ${opposing.datetime}`,
    };
  }

  if (bars >= opts.staleAfter) {
    return { flag: "Stale", reason: `${bars} candles old with no resolution near entry` };
  }
  if (bars >= opts.agingAfter) {
    return { flag: "Aging", reason: `${bars} candles since trigger, signal cooling` };
  }
  return { flag: "Fresh", reason: `only ${bars} candle(s) since trigger` };
}
