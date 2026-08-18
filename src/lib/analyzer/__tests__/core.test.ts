import { describe, expect, it } from "vitest";

import { applySpreadAndRR, RR_FAIL_REASON, RR_THRESHOLD } from "../math";
import { parseCsv, parseSpread, splitCsvLine } from "../parse";
import { buildIndex, computeMarketStructure, resolveSwings, trendFrom } from "../structure";
import { runAnalysis } from "../run";
import { buildReport, exportFileName } from "../export";
import { BULL_REFS, BULL_SWINGS, dtFor, makeCandle, makeCtx, metadataLine } from "./helpers";

const HEADER =
  "datetime,open,high,low,close,direction,body,upper_wick,lower_wick,range,body_percent_of_range,upper_wick_pct,lower_wick_pct,displacement,is_reliable,local_avg_range,session,atr_30m,similar_swing_retrace_pct,similar_swing_continued_pct,similar_swing_refs,swing_invalidated,reliable_streak_length";

function row(dt: string, o: number, h: number, l: number, c: number, refs = "[]", reliable = "true") {
  return `${dt},${o},${h},${l},${c},bullish,1,1,1,2,50,20,20,No,${reliable},1,london,1,100,50,"${refs}",false,3`;
}

describe("parse", () => {
  it("splits quoted CSV fields containing commas", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(splitCsvLine('a,"say ""hi""",d')).toEqual(["a", 'say "hi"', "d"]);
  });

  it("rejects a file with a missing metadata field", () => {
    const text = [
      JSON.stringify({ data_age: "2h", spread_convention: "0.0002", atr_method: "wilder-14" }),
      HEADER,
      row("2024-01-02 00:00", 1, 2, 0.5, 1.5),
    ].join("\n");
    const parsed = parseCsv(text);
    expect(parsed.meta).toBeUndefined();
    expect(parsed.metadataError).toBe(
      "INVALID FILE: missing metadata field similar_swing_selection_rule",
    );
  });

  it("rejects an empty metadata value", () => {
    const parsed = parseCsv([metadataLine({ data_age: "  " }), HEADER].join("\n"));
    expect(parsed.metadataError).toBe("INVALID FILE: missing metadata field data_age");
  });

  it("parses a metadata line with a prefix before the JSON object", () => {
    for (const prefix of ["# metadata: ", "## meta -> ", ""]) {
      const parsed = parseCsv([prefix + metadataLine(), HEADER].join("\n"));
      expect(parsed.metadataError).toBeUndefined();
      expect(parsed.meta?.data_age).toBeTruthy();
      expect(parsed.meta?.spread_convention).toBeTruthy();
      expect(parsed.meta?.atr_method).toBeTruthy();
      expect(parsed.meta?.similar_swing_selection_rule).toBeTruthy();
    }
  });

  it("rejects a metadata line with no JSON object at all", () => {
    const parsed = parseCsv(["# metadata: none", HEADER].join("\n"));
    expect(parsed.metadataError).toBe("INVALID FILE: metadata header line is not valid JSON");
  });


  it("flags rows missing core fields but keeps them in the row list", () => {
    const text = [
      metadataLine(),
      HEADER,
      row("2024-01-02 00:00", 1, 2, 0.5, 1.5),
      `2024-01-02 00:30,,,,,bullish,1,1,1,2,50,20,20,No,true,1,london,1,100,50,"[]",false,3`,
    ].join("\n");
    const parsed = parseCsv(text);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.candles[0]!.invalid).toBeUndefined();
    expect(parsed.candles[1]!.invalid).toBe("INVALID: missing core fields");
  });

  it("extracts the spread from the convention text", () => {
    expect(parseSpread("0.0002")).toBeCloseTo(0.0002);
    expect(parseSpread("1.5 pips")).toBeCloseTo(0.00015);
    expect(parseSpread("none")).toBe(0);
  });
});

describe("market structure", () => {
  it("marks rising highs and lows as bullish", () => {
    const ctx = makeCtx([...BULL_SWINGS, { o: 102, h: 103, l: 102, c: 102.5, refs: BULL_REFS }]);
    expect(ctx.candles[3]!.trend).toBe("bullish");
  });

  it("marks falling highs and lows as bearish", () => {
    const specs = [
      { o: 102, h: 102, l: 101, c: 101.5 },
      { o: 101, h: 101, l: 100, c: 100.5 },
      { o: 100, h: 100, l: 99, c: 99.5 },
    ];
    const ctx = makeCtx([...specs, { o: 99, h: 99.5, l: 98, c: 98.5, refs: BULL_REFS }]);
    expect(ctx.candles[3]!.trend).toBe("bearish");
  });

  it("falls back to ranging when swings are mixed", () => {
    const specs = [
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 103, l: 98, c: 100 },
      { o: 100, h: 102, l: 99.5, c: 100 },
    ];
    const ctx = makeCtx([...specs, { o: 100, h: 101, l: 99, c: 100, refs: BULL_REFS }]);
    expect(ctx.candles[3]!.trend).toBe("ranging");
  });

  it("reports unresolved refs instead of dropping them", () => {
    const ctx = makeCtx([
      ...BULL_SWINGS,
      { o: 102, h: 103, l: 102, c: 102.5, refs: [dtFor(0), "1999-01-01 00:00"] },
    ]);
    expect(ctx.candles[3]!.unresolvedRefs).toEqual(["1999-01-01 00:00"]);
  });

  it("resolveSwings keeps only the last 5 resolved swings", () => {
    const specs = Array.from({ length: 8 }, (_, i) => ({
      o: 100 + i,
      h: 100.5 + i,
      l: 99.5 + i,
      c: 100.2 + i,
    }));
    const candles = [...specs, { o: 110, h: 111, l: 109, c: 110 }].map(makeCandle);
    candles[8]!.similarSwingRefs = specs.map((_, i) => dtFor(i));
    const byDatetime = buildIndex(candles);
    computeMarketStructure(candles, byDatetime);
    const swings = resolveSwings(candles[8]!, byDatetime);
    expect(swings.candles).toHaveLength(5);
    expect(trendFrom(swings)).toBe("bullish");
  });
});

describe("RR math", () => {
  it("applies the spread to the entry of a long and computes RR", () => {
    const adjusted = applySpreadAndRR(
      { result: "PASS", reason: "x", side: "long", entry: 100, sl: 99, tp: 103 },
      0.5,
    );
    expect(adjusted!.entry).toBe(100.5);
    expect(adjusted!.rr).toBeCloseTo(2.5 / 1.5);
  });

  it("mirrors the spread for a short", () => {
    const adjusted = applySpreadAndRR(
      { result: "PASS", reason: "x", side: "short", entry: 100, sl: 101, tp: 96 },
      0.5,
    );
    expect(adjusted!.entry).toBe(99.5);
    expect(adjusted!.rr).toBeCloseTo(3.5 / 1.5);
  });

  it("returns undefined when a price is missing", () => {
    expect(applySpreadAndRR({ result: "PASS", reason: "x", entry: 1, sl: 2 }, 0)).toBeUndefined();
  });

  it("exposes the 1:2 threshold and its reason", () => {
    expect(RR_THRESHOLD).toBe(2);
    expect(RR_FAIL_REASON).toBe("RR below 1:2 threshold");
  });
});

describe("runAnalysis", () => {
  const text = [
    metadataLine(),
    HEADER,
    row("2024-01-02 00:00", 99.5, 100, 99, 99.8),
    row("2024-01-02 00:30", 100.5, 101, 100, 100.8),
    `2024-01-02 01:00,,,,,bullish,1,1,1,2,50,20,20,No,true,1,london,1,100,50,"[]",false,3`,
  ].join("\n");

  it("stops at the metadata gate", () => {
    const outcome = runAnalysis([JSON.stringify({ data_age: "2h" }), HEADER].join("\n"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("INVALID FILE: missing metadata field");
  });

  it("counts INVALID rows in the summary but excludes them from strategy checks", () => {
    const outcome = runAnalysis(text);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { analysis } = outcome;
    expect(analysis.totalRows).toBe(3);
    expect(analysis.invalidRows).toBe(1);
    expect(analysis.analyzedRows).toBe(2);
    expect(analysis.results.every((r) => r.datetime !== "2024-01-02 01:00")).toBe(true);
    expect(analysis.perStrategy).toHaveLength(13);
    expect(analysis.results).toHaveLength(2 * 13);
  });

  it("gives every analyzed row a reason for every strategy", () => {
    const outcome = runAnalysis(text);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.analysis.results.every((r) => r.reason.trim().length > 0)).toBe(true);
  });

  it("names the export from the last row datetime and writes both sections", () => {
    const outcome = runAnalysis(text);
    if (!outcome.ok) throw new Error("expected success");
    expect(exportFileName(outcome.analysis)).toBe("structure-scout_LIVE_2024-01-02-01-00.txt");
    expect(exportFileName(outcome.analysis, "HISTORY")).toBe(
      "structure-scout_HISTORY_2024-01-02-01-00.txt",
    );
    const report = buildReport(outcome.analysis);
    expect(report).toContain("=== SUMMARY ===");
    expect(buildReport(outcome.analysis, "HISTORY")).toContain("=== RESULTS ===");
    expect(report).toContain("data_age: 2h");
  });
});
