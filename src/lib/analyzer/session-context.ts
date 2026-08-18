import { dayOf, type SessionBlock } from "./indicators";
import type { Candle } from "./types";

export interface SessionPatternContext {
  day: string;
  /** Asian session range for the setup's day, from the existing session tagging. */
  asianHigh?: number | undefined;
  asianLow?: number | undefined;
  asianRange?: number | undefined;
  asianRangeText: string;
  londonOpenDirection: string;
  nyOpenDirection: string;
  setupSession: string;
  summary: string;
}

function isSession(name: string | undefined, pattern: RegExp): boolean {
  return !!name && pattern.test(name);
}

const ASIAN = /asia|tokyo|sydney/i;
const LONDON = /london|europe|eu\b/i;
const NEWYORK = /new.?york|\bny\b|us\b|america/i;

/** Direction of a session block's open: first open -> last close. */
function blockDirection(candles: Candle[], block: SessionBlock | undefined): string {
  if (!block) return "no data";
  const first = candles.find((c) => c.index === block.start);
  const open = first?.open;
  if (open === undefined) return "no data";
  const move = block.close - open;
  if (move === 0) return "flat";
  return move > 0 ? `up (${open.toFixed(5)} → ${block.close.toFixed(5)})` : `down (${open.toFixed(5)} → ${block.close.toFixed(5)})`;
}

/**
 * Session pattern context for a setup: the day's Asian range plus the London and
 * New York open direction. Context only — never gates a setup.
 */
export function sessionContextFor(
  candles: Candle[],
  blocks: SessionBlock[],
  candle: Candle,
): SessionPatternContext {
  const day = dayOf(candle.datetime);
  const dayBlocks = blocks.filter((b) => b.day === day);

  const asian = dayBlocks.filter((b) => isSession(b.session, ASIAN));
  const asianHigh = asian.length > 0 ? Math.max(...asian.map((b) => b.high)) : undefined;
  const asianLow = asian.length > 0 ? Math.min(...asian.map((b) => b.low)) : undefined;
  const asianRange =
    asianHigh !== undefined && asianLow !== undefined ? asianHigh - asianLow : undefined;

  const london = dayBlocks.find((b) => isSession(b.session, LONDON));
  const ny = dayBlocks.find((b) => isSession(b.session, NEWYORK));

  const asianRangeText =
    asianRange === undefined
      ? "no Asian session rows for this day"
      : `${asianLow!.toFixed(5)}–${asianHigh!.toFixed(5)} (${asianRange.toFixed(5)})`;

  const londonOpenDirection = blockDirection(candles, london);
  const nyOpenDirection = blockDirection(candles, ny);

  return {
    day,
    asianHigh,
    asianLow,
    asianRange,
    asianRangeText,
    londonOpenDirection,
    nyOpenDirection,
    setupSession: candle.session ?? "untagged",
    summary: `Asian ${asianRangeText} · London ${londonOpenDirection} · NY ${nyOpenDirection}`,
  };
}
