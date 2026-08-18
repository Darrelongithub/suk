import { describe, expect, it } from "vitest";
import { evaluateSetupStatus } from "../status";
import { parseCsv } from "../parse";
import type { Candle, ResultRow } from "../types";

function candle(index: number, low: number, high: number): Candle {
  return {
    index,
    datetime: `d${index}`,
    open: low,
    high,
    low,
    close: high,
    similarSwingRefs: [],
    unresolvedRefs: [],
    trend: "ranging",
    raw: {},
  };
}

const base: ResultRow = {
  strategyId: "s",
  strategy: "S",
  index: 0,
  datetime: "d0",
  result: "PASS",
  reason: "ok",
  trend: "bullish",
  side: "long",
  entry: 100,
  sl: 90,
  tp: 120,
};

describe("evaluateSetupStatus", () => {
  it("marks a setup RESOLVED when TP is hit after the fill", () => {
    const candles = [candle(0, 100, 101), candle(1, 99, 100.5), candle(2, 110, 121)];
    expect(evaluateSetupStatus(base, candles).setupStatus).toBe("RESOLVED");
  });

  it("marks a setup RESOLVED when SL breaks before any fill", () => {
    const candles = [candle(0, 100, 101), candle(1, 89, 95)];
    expect(evaluateSetupStatus(base, candles).setupStatus).toBe("RESOLVED");
  });

  it("marks an unfilled recent setup PENDING", () => {
    const candles = [candle(0, 100, 101), candle(1, 95, 99)];
    expect(evaluateSetupStatus(base, candles).setupStatus).toBe("PENDING");
  });

  it("marks a filled but unresolved setup FILLED", () => {
    const candles = [candle(0, 100, 101), candle(1, 99.5, 100.5), candle(2, 101, 105)];
    expect(evaluateSetupStatus(base, candles).setupStatus).toBe("FILLED");
  });

  it("expires a setup with no fill after the expiry window", () => {
    const candles = [candle(0, 100, 101), ...Array.from({ length: 25 }, (_, i) => candle(i + 1, 95, 99))];
    expect(evaluateSetupStatus(base, candles, 20).setupStatus).toBe("EXPIRED");
  });
});

describe("parseCsv day headers", () => {
  it("skips === divider rows entirely", () => {
    const text = [
      '# metadata: {"data_age":"1h","spread_convention":"1.2 pips","atr_method":"wilder-14","similar_swing_selection_rule":"last 5"}',
      "datetime,open,high,low,close,is_reliable",
      "=== MONDAY 2026-07-13 (UTC) ===",
      "2026-07-13 00:00,1,2,0.5,1.5,true",
      "=== TUESDAY 2026-07-14 (UTC) ===",
      "2026-07-14 00:00,1,2,0.5,1.5,true",
    ].join("\n");
    const parsed = parseCsv(text);
    expect(parsed.candles).toHaveLength(2);
    expect(parsed.candles.every((c) => !c.invalid)).toBe(true);
  });
});

describe("divider detection via section_marker_convention", () => {
  const rows = (marker: string) =>
    [
      `# metadata: {"data_age":"1h","spread_convention":"1.2 pips","atr_method":"wilder-14","similar_swing_selection_rule":"last 5","section_marker_convention":"divider lines are wrapped in ${marker}"}`,
      "datetime,open,high,low,close,is_reliable",
      `${marker} MONDAY 2026-07-13 (UTC) ${marker}`,
      "2026-07-13 00:00,1,2,0.5,1.5,true",
      `${marker} WEEKEND GAP ${marker}`,
      "2026-07-14 00:00,1,2,0.5,1.5,true",
    ].join("\n");

  it("skips dividers using the documented marker, not a hardcoded ===", () => {
    for (const marker of ["===", "---", "###"]) {
      const parsed = parseCsv(rows(marker));
      expect(parsed.candles).toHaveLength(2);
      expect(parsed.candles.every((c) => !c.invalid)).toBe(true);
    }
  });

  it("never logs a marker-less, numberless divider as INVALID", () => {
    const text = [
      '# metadata: {"data_age":"1h","spread_convention":"1.2 pips","atr_method":"wilder-14","similar_swing_selection_rule":"last 5"}',
      "datetime,open,high,low,close,is_reliable",
      "WEEKEND — market closed",
      "2026-07-13 00:00,1,2,0.5,1.5,true",
    ].join("\n");
    const parsed = parseCsv(text);
    expect(parsed.candles).toHaveLength(1);
  });
});
