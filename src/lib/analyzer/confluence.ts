import { fib618 } from "./indicators";
import { resolveSwings } from "./structure";
import type { AnalysisContext, Candle } from "./types";

export interface ConfluenceFactor {
  name: string;
  level: number;
  distance: number;
}

export interface ConfluenceContext {
  count: number;
  total: number;
  /** e.g. "3/5" */
  score: string;
  matched: string[];
  missed: string[];
  detail: string;
}

export const CONFLUENCE_FACTORS = [
  "fib_618",
  "prior_swing",
  "prior_day_high_low",
  "round_number",
  "key_ema",
] as const;

/**
 * Tolerance around entry: 25% of ATR(30m) when available, otherwise 0.1% of price.
 * Never estimated from missing data — falls back to a pure percentage of entry.
 */
export function confluenceTolerance(entry: number, atr: number | undefined): number {
  if (atr !== undefined && atr > 0) return atr * 0.25;
  return Math.abs(entry) * 0.001;
}

/** Nearest "round number" at a scale two decades below the price magnitude. */
export function roundNumberNear(price: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(price) || 1));
  const step = Math.pow(10, magnitude - 2);
  return Math.round(price / step) * step;
}

function priorDayLevels(
  candles: Candle[],
  candle: Candle,
): { high: number; low: number } | undefined {
  const dayOf = (dt: string) => dt.trim().split(/[ T]/)[0] ?? dt;
  const today = dayOf(candle.datetime);
  let priorDay: string | undefined;
  for (const c of candles) {
    if (c.index >= candle.index) break;
    const day = dayOf(c.datetime);
    if (day !== today) priorDay = day;
  }
  if (!priorDay) return undefined;
  let high: number | undefined;
  let low: number | undefined;
  for (const c of candles) {
    if (c.index >= candle.index) break;
    if (dayOf(c.datetime) !== priorDay) continue;
    if (c.high !== undefined) high = high === undefined ? c.high : Math.max(high, c.high);
    if (c.low !== undefined) low = low === undefined ? c.low : Math.min(low, c.low);
  }
  if (high === undefined || low === undefined) return undefined;
  return { high, low };
}

/**
 * Context-only ranking signal: counts how many independent reference levels sit
 * near the entry price. Never gates a setup.
 */
export function computeConfluence(
  ctx: AnalysisContext,
  candle: Candle,
  entry: number,
): ConfluenceContext {
  const tol = confluenceTolerance(entry, candle.atr30m);
  const near = (level: number) => Math.abs(level - entry) <= tol;
  const matched: string[] = [];
  const missed: string[] = [];
  const detail: string[] = [];

  const swings = resolveSwings(candle, ctx.byDatetime);

  // 1. Fibonacci 61.8% retracement of the resolved swing range (existing fib logic).
  let fibHit = false;
  if (swings.highs.length >= 2 && swings.lows.length >= 2) {
    const swingHigh = Math.max(...swings.highs);
    const swingLow = Math.min(...swings.lows);
    const up = fib618(swingLow, swingHigh);
    const down = fib618(swingHigh, swingLow);
    if (near(up) || near(down)) {
      fibHit = true;
      detail.push(`fib 61.8% @ ${(near(up) ? up : down).toFixed(5)}`);
    }
  }
  (fibHit ? matched : missed).push("fib_618");

  // 2. A prior swing high or low.
  const swingLevels = [...swings.highs, ...swings.lows];
  const swingHit = swingLevels.find((level) => near(level));
  if (swingHit !== undefined) detail.push(`prior swing @ ${swingHit.toFixed(5)}`);
  (swingHit !== undefined ? matched : missed).push("prior_swing");

  // 3. Prior day's high or low.
  const prior = priorDayLevels(ctx.candles, candle);
  const priorHit = prior && (near(prior.high) ? prior.high : near(prior.low) ? prior.low : undefined);
  if (priorHit !== undefined && priorHit !== null)
    detail.push(`prior day level @ ${priorHit.toFixed(5)}`);
  (priorHit !== undefined && priorHit !== null ? matched : missed).push("prior_day_high_low");

  // 4. Round number.
  const round = roundNumberNear(entry);
  if (near(round)) detail.push(`round number @ ${round}`);
  (near(round) ? matched : missed).push("round_number");

  // 5. Proximity to a key EMA (50 or 200).
  const ema50 = ctx.ema50[candle.index];
  const ema200 = ctx.ema200[candle.index];
  const emaHit =
    ema50 !== undefined && near(ema50)
      ? `EMA50 @ ${ema50.toFixed(5)}`
      : ema200 !== undefined && near(ema200)
        ? `EMA200 @ ${ema200.toFixed(5)}`
        : undefined;
  if (emaHit) detail.push(emaHit);
  (emaHit ? matched : missed).push("key_ema");

  return {
    count: matched.length,
    total: CONFLUENCE_FACTORS.length,
    score: `${matched.length}/${CONFLUENCE_FACTORS.length}`,
    matched,
    missed,
    detail: detail.length > 0 ? detail.join("; ") : "no reference levels within tolerance",
  };
}
