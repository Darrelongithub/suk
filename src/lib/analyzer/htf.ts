import { trendFrom } from "./structure";
import type { Candle, Trend } from "./types";

export type HtfTimeframe = "H1" | "H4" | "D1";

export interface HtfPeriod {
  key: string;
  timeframe: HtfTimeframe;
  /** Index of the last 30m candle inside this period. */
  endIndex: number;
  high: number;
  low: number;
  close: number;
}

/** Parses "YYYY-MM-DD HH:MM" (or ISO) into its date + hour parts. No estimation. */
function parts(datetime: string): { day: string; hour: number } | undefined {
  const match = datetime.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return undefined;
  return { day: match[1]!, hour: Number(match[2]) };
}

function bucketKey(datetime: string, timeframe: HtfTimeframe): string | undefined {
  const p = parts(datetime);
  if (!p) return undefined;
  if (timeframe === "D1") return p.day;
  const size = timeframe === "H1" ? 1 : 4;
  const bucket = Math.floor(p.hour / size) * size;
  return `${p.day} ${String(bucket).padStart(2, "0")}:00`;
}

/**
 * Pure aggregation of 30m candles into higher timeframes: max high, min low and
 * the last close of each period. Nothing is interpolated or estimated.
 */
export function aggregate(candles: Candle[], timeframe: HtfTimeframe): HtfPeriod[] {
  const periods: HtfPeriod[] = [];
  let current: HtfPeriod | undefined;
  for (const candle of candles) {
    if (candle.invalid) continue;
    if (candle.high === undefined || candle.low === undefined || candle.close === undefined) continue;
    const key = bucketKey(candle.datetime, timeframe);
    if (!key) continue;
    if (!current || current.key !== key) {
      current = {
        key,
        timeframe,
        endIndex: candle.index,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
      periods.push(current);
    } else {
      current.endIndex = candle.index;
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    }
  }
  return periods;
}

/** How many completed periods are read for a trend read at each timeframe. */
export const TREND_LOOKBACK = 3;

/**
 * Applies the existing `trendFrom` swing logic (rising highs + rising lows =
 * bullish, falling = bearish, otherwise ranging) to aggregated HTF periods.
 */
export function identifyTrend(periods: HtfPeriod[], lookback = TREND_LOOKBACK): Trend {
  const window = periods.slice(-lookback);
  if (window.length < 2) return "ranging";
  return trendFrom({
    candles: [],
    highs: window.map((p) => p.high),
    lows: window.map((p) => p.low),
    unresolved: [],
  });
}

export interface HtfTrendContext {
  h1: Trend;
  h4: Trend;
  d1: Trend;
  /** "aligned" | "counter" | "neutral" per timeframe, relative to the setup side. */
  h1Alignment: HtfAlignment;
  h4Alignment: HtfAlignment;
  d1Alignment: HtfAlignment;
  /** How many of H1/H4/D1 agree with the setup direction. */
  alignedCount: number;
  summary: string;
}

export type HtfAlignment = "aligned" | "counter" | "neutral";

export interface HtfModel {
  h1: HtfPeriod[];
  h4: HtfPeriod[];
  d1: HtfPeriod[];
}

export function buildHtfModel(candles: Candle[]): HtfModel {
  return {
    h1: aggregate(candles, "H1"),
    h4: aggregate(candles, "H4"),
    d1: aggregate(candles, "D1"),
  };
}

function alignment(trend: Trend, side: "long" | "short" | undefined): HtfAlignment {
  if (trend === "ranging" || !side) return "neutral";
  const bullish = trend === "bullish";
  return (bullish && side === "long") || (!bullish && side === "short") ? "aligned" : "counter";
}

/**
 * HTF trend context as of the setup candle: only periods that ended at or before
 * the setup are considered, so nothing looks into the future.
 */
export function htfContextAt(
  model: HtfModel,
  index: number,
  side: "long" | "short" | undefined,
): HtfTrendContext {
  const upTo = (periods: HtfPeriod[]) => periods.filter((p) => p.endIndex <= index);
  const h1 = identifyTrend(upTo(model.h1));
  const h4 = identifyTrend(upTo(model.h4));
  const d1 = identifyTrend(upTo(model.d1));
  const h1Alignment = alignment(h1, side);
  const h4Alignment = alignment(h4, side);
  const d1Alignment = alignment(d1, side);
  const alignedCount = [h1Alignment, h4Alignment, d1Alignment].filter((a) => a === "aligned").length;
  return {
    h1,
    h4,
    d1,
    h1Alignment,
    h4Alignment,
    d1Alignment,
    alignedCount,
    summary: `H1 ${h1} (${h1Alignment}) · H4 ${h4} (${h4Alignment}) · D1 ${d1} (${d1Alignment})`,
  };
}
