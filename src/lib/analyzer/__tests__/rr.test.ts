import { describe, expect, it } from "vitest";
import {
  applySpreadAndRR,
  NON_POSITIVE_RISK_REASON,
  SL_SIDE_REASON,
} from "../math";
import type { Outcome } from "../types";

const pass = (o: Partial<Outcome>): Outcome => ({
  result: "PASS",
  reason: "test",
  side: "long",
  ...o,
});

describe("RR math", () => {
  it("keeps RR signed instead of absolute when the target is on the wrong side", () => {
    const math = applySpreadAndRR(pass({ entry: 100, sl: 99, tp: 90 }), 0)!;
    expect(math.rr).toBeCloseTo(-10);
  });

  it("refuses to compute RR when SL sits above a long entry", () => {
    const math = applySpreadAndRR(pass({ entry: 4109.38, sl: 4109.92, tp: 4120 }), 0)!;
    expect(math.rr).toBeUndefined();
    expect(math.invalidReason).toBe(SL_SIDE_REASON);
  });

  it("refuses to compute RR when SL sits below a short entry", () => {
    const math = applySpreadAndRR(pass({ side: "short", entry: 100, sl: 99, tp: 90 }), 0)!;
    expect(math.rr).toBeUndefined();
    expect(math.invalidReason).toBe(SL_SIDE_REASON);
  });

  it("flags zero risk as non-positive rather than returning RR 0", () => {
    const math = applySpreadAndRR(pass({ entry: 100, sl: 100, tp: 110 }), 0)!;
    expect([SL_SIDE_REASON, NON_POSITIVE_RISK_REASON]).toContain(math.invalidReason);
    expect(math.rr).toBeUndefined();
  });

  it("computes a normal long RR with spread on entry", () => {
    const math = applySpreadAndRR(pass({ entry: 100, sl: 99, tp: 103 }), 0.1)!;
    expect(math.entry).toBeCloseTo(100.1);
    expect(math.rr).toBeCloseTo((103 - 100.1) / (100.1 - 99));
  });
});
