import { ema, sessionBlocks } from "../indicators";
import { parseSpread } from "../parse";
import { buildIndex, computeMarketStructure } from "../structure";
import type { AnalysisContext, Candle, Metadata } from "../types";

export const META: Metadata = {
  data_age: "2h",
  spread_convention: "0.0002",
  atr_method: "wilder-14",
  similar_swing_selection_rule: "last 5 similar swings",
};

export interface RowSpec {
  dt?: string;
  o: number;
  h: number;
  l: number;
  c: number;
  reliable?: boolean;
  displacement?: string;
  upper?: number;
  lower?: number;
  body?: number;
  session?: string;
  refs?: string[];
  invalidated?: boolean;
  retrace?: number;
}

/** Deterministic minute-spaced datetimes so refs are easy to write in tests. */
export function dtFor(index: number): string {
  const minutes = index * 30;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `2024-01-02 ${hh}:${mm}`;
}

export function makeCandle(spec: RowSpec, index: number): Candle {
  return {
    index,
    datetime: spec.dt ?? dtFor(index),
    open: spec.o,
    high: spec.h,
    low: spec.l,
    close: spec.c,
    direction: spec.c >= spec.o ? "bullish" : "bearish",
    body: Math.abs(spec.c - spec.o),
    upperWick: spec.h - Math.max(spec.o, spec.c),
    lowerWick: Math.min(spec.o, spec.c) - spec.l,
    range: spec.h - spec.l,
    bodyPercentOfRange: spec.body ?? 50,
    upperWickPct: spec.upper ?? 0,
    lowerWickPct: spec.lower ?? 0,
    displacement: spec.displacement ?? "No",
    isReliable: spec.reliable ?? true,
    localAvgRange: 1,
    session: spec.session ?? "london",
    atr30m: 1,
    similarSwingRetracePct: spec.retrace ?? 100,
    similarSwingContinuedPct: 50,
    similarSwingRefs: spec.refs ?? [],
    unresolvedRefs: [],
    swingInvalidated: spec.invalidated ?? false,
    reliableStreakLength: 3,
    trend: "ranging",
    raw: {},
  };
}

export function makeCtx(specs: RowSpec[]): AnalysisContext {
  const candles = specs.map(makeCandle);
  const byDatetime = buildIndex(candles);
  computeMarketStructure(candles, byDatetime);
  return {
    meta: META,
    candles,
    byDatetime,
    ema50: ema(candles, 50),
    ema200: ema(candles, 200),
    blocks: sessionBlocks(candles),
    spread: parseSpread(META.spread_convention),
  };
}

/** Three rising swing rows (highs 100/101/102, lows 99/100/101) => bullish trend. */
export const BULL_SWINGS: RowSpec[] = [
  { o: 99.5, h: 100, l: 99, c: 99.8 },
  { o: 100.5, h: 101, l: 100, c: 100.8 },
  { o: 101.5, h: 102, l: 101, c: 101.8 },
];

export const BULL_REFS = [dtFor(0), dtFor(1), dtFor(2)];

export function metadataLine(overrides: Partial<Record<string, string>> = {}): string {
  return JSON.stringify({ ...META, ...overrides });
}
