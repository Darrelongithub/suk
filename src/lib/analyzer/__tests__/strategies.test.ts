import { describe, expect, it } from "vitest";

import { STRATEGIES } from "../strategies";
import { asianLondon } from "../strategies/asian-london";
import { bosRetest } from "../strategies/bos-retest";
import { emaPullback } from "../strategies/ema-pullback";
import { engulfing } from "../strategies/engulfing";
import { fibPattern } from "../strategies/fib-pattern";
import { fvgFill } from "../strategies/fvg-fill";
import { liquiditySweep } from "../strategies/liquidity-sweep";
import { openingRange } from "../strategies/opening-range";
import { orderBlock } from "../strategies/order-block";
import { pinBar } from "../strategies/pin-bar";
import { pivotRejection } from "../strategies/pivot-rejection";
import { rangeRejection } from "../strategies/range-rejection";
import { swingFailure } from "../strategies/swing-failure";
import { BULL_REFS, BULL_SWINGS, dtFor, makeCtx, type RowSpec } from "./helpers";

function outcome(strategy: (typeof STRATEGIES)[number], specs: RowSpec[], index: number) {
  return strategy.run(makeCtx(specs), index);
}

describe("1 — Break of Structure + Retest", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 102, h: 105, l: 102, c: 104.5, displacement: "Yes", refs: BULL_REFS, retrace: 100 },
    { o: 104, h: 103.5, l: 101.8, c: 103, refs: BULL_REFS },
  ];

  it("passes on a reliable retest of the broken swing", () => {
    const result = outcome(bosRetest, base, 3);
    expect(result.result).toBe("PASS");
    expect(result.entry).toBe(103.5);
    expect(result.sl).toBe(101.8);
  });

  it("fails when the candle is not a displacement candle", () => {
    const specs = structuredClone(base);
    specs[3]!.displacement = "No";
    expect(outcome(bosRetest, specs, 3)).toMatchObject({
      result: "FAIL",
      reason: "displacement != Yes",
    });
  });

  it("reports the exact missing field", () => {
    const specs = structuredClone(base);
    delete specs[3]!.retrace;
    const ctx = makeCtx(specs);
    ctx.candles[3]!.similarSwingRetracePct = undefined;
    expect(bosRetest.run(ctx, 3).reason).toBe("missing field: similar_swing_retrace_pct");
  });
});

describe("2 — Liquidity Sweep + Reclaim", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 101.9, h: 103, l: 101.5, c: 101.6, upper: 60, refs: BULL_REFS },
  ];

  it("passes when the wick sweeps a swing high and price reclaims below", () => {
    const result = outcome(liquiditySweep, base, 3);
    expect(result.result).toBe("PASS");
    expect(result.side).toBe("short");
    expect(result.tp).toBe(99);
  });

  it("fails when the wick percentage is under 55%", () => {
    const specs = structuredClone(base);
    specs[3]!.upper = 40;
    expect(outcome(liquiditySweep, specs, 3).reason).toBe("upper_wick_pct 40% below 55%");
  });
});

describe("3 — Horizontal Range + Boundary Rejection", () => {
  const rangeSwings: RowSpec[] = [
    { o: 99.5, h: 100, l: 99, c: 99.8 },
    { o: 99.6, h: 100.1, l: 99.05, c: 99.9 },
    { o: 99.7, h: 100.2, l: 99.1, c: 100 },
  ];
  const base: RowSpec[] = [
    ...rangeSwings,
    { o: 100, h: 100.15, l: 99.9, c: 99.95, upper: 60, refs: BULL_REFS },
  ];

  it("passes on a wick rejection at the range top", () => {
    const result = outcome(rangeRejection, base, 3);
    expect(result.result).toBe("PASS");
    expect(result.tp).toBe(99);
  });

  it("fails when the rejection wick is under 50%", () => {
    const specs = structuredClone(base);
    specs[3]!.upper = 30;
    expect(outcome(rangeRejection, specs, 3).reason).toContain("below 50% at range top");
  });
});

describe("4 — Order Block Return", () => {
  const base: RowSpec[] = [
    { o: 101, h: 101.2, l: 100.5, c: 100.6 },
    { o: 100.6, h: 104, l: 100.5, c: 103.8, displacement: "Yes" },
    { o: 103.8, h: 104, l: 101, c: 101.2 },
  ];

  it("passes when price returns into the order block", () => {
    const result = outcome(orderBlock, base, 2);
    expect(result.result).toBe("PASS");
    expect(result.entry).toBe(101.2);
    expect(result.sl).toBe(100.5);
  });

  it("fails when the order block candle is unreliable", () => {
    const specs = structuredClone(base);
    specs[0]!.reliable = false;
    expect(outcome(orderBlock, specs, 2).reason).toBe(
      "order block candle has is_reliable = false",
    );
  });
});

describe("5 — Fair Value Gap Fill", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 102, h: 102.5, l: 102, c: 102.4 },
    { o: 102.4, h: 104, l: 102.4, c: 103.9 },
    { o: 104, h: 105, l: 103.5, c: 104.8 },
    { o: 104, h: 104, l: 102.4, c: 102.6, refs: BULL_REFS },
  ];

  it("passes when price returns to fill a trend-aligned gap", () => {
    const result = outcome(fvgFill, base, 6);
    expect(result.result).toBe("PASS");
    expect(result.side).toBe("long");
  });

  it("fails when a gap candle is unreliable", () => {
    const specs = structuredClone(base);
    specs[5]!.reliable = false;
    expect(outcome(fvgFill, specs, 6).reason).toContain("is_reliable = false");
  });
});

describe("6 — Pin Bar at Key Level", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 101.4, h: 101.6, l: 101, c: 101.5, body: 20, lower: 70, refs: BULL_REFS },
  ];

  it("passes on a trend-aligned pin bar at a swing level", () => {
    const result = outcome(pinBar, base, 3);
    expect(result.result).toBe("PASS");
    expect(result.tp).toBe(102);
  });

  it("fails when the body is too large", () => {
    const specs = structuredClone(base);
    specs[3]!.body = 60;
    expect(outcome(pinBar, specs, 3).reason).toBe("body_percent_of_range 60% above 35%");
  });
});

describe("7 — Engulfing at Support/Resistance", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 101.4, h: 101.5, l: 101.2, c: 101.3 },
    { o: 101.2, h: 101.7, l: 101, c: 101.5, refs: BULL_REFS },
  ];

  it("passes when the body engulfs the prior body at a swing level", () => {
    const result = outcome(engulfing, base, 4);
    expect(result.result).toBe("PASS");
    expect(result.side).toBe("long");
  });

  it("fails when the body does not engulf", () => {
    const specs = structuredClone(base);
    specs[4]!.o = 101.35;
    expect(outcome(engulfing, specs, 4).reason).toBe("body does not fully engulf prior candle body");
  });
});

describe("8 — Pin Bar/Engulfing at 61.8% Fib", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 100.5, h: 100.7, l: 100.146, c: 100.6, body: 20, lower: 70, refs: BULL_REFS },
  ];

  it("passes with a pin bar sitting on the 61.8% retracement", () => {
    const result = outcome(fibPattern, base, 3);
    expect(result.result).toBe("PASS");
    expect(result.tp).toBe(102);
  });

  it("fails when price is away from the 61.8% level", () => {
    const specs = structuredClone(base);
    specs[3]!.l = 101.5;
    specs[3]!.o = 101.6;
    specs[3]!.c = 101.7;
    specs[3]!.h = 101.8;
    expect(outcome(fibPattern, specs, 3).reason).toContain("not within 0.5% of 61.8% level");
  });
});

describe("9 — Pivot Point Rejection", () => {
  const base: RowSpec[] = [
    { o: 99, h: 102, l: 98, c: 100, session: "asian" },
    { o: 100, h: 100.5, l: 99.5, c: 99.5, session: "london", upper: 60 },
  ];

  it("passes on a wick rejection of the prior session pivot", () => {
    const result = outcome(pivotRejection, base, 1);
    expect(result.result).toBe("PASS");
    expect(result.tp).toBeCloseTo(96);
  });

  it("fails when there is no prior session", () => {
    expect(outcome(pivotRejection, [base[1]!], 0).reason).toBe(
      "no prior session available to compute pivot levels",
    );
  });
});

describe("10 — Asian Sweep + London Reclaim", () => {
  const base: RowSpec[] = [
    { o: 100, h: 100.5, l: 99.5, c: 100.2, session: "asian" },
    { o: 100.2, h: 101, l: 100, c: 100.3, session: "asian" },
    { o: 100.3, h: 100.4, l: 100, c: 100.1, session: "london" },
  ];

  it("passes when london reclaims the asian sweep", () => {
    const result = outcome(asianLondon, base, 1);
    expect(result.result).toBe("PASS");
    expect(result.side).toBe("short");
    expect(result.sl).toBe(101);
  });

  it("fails when the sweep candle is not in the asian session", () => {
    const specs = structuredClone(base);
    specs[1]!.session = "ny";
    expect(outcome(asianLondon, specs, 1).reason).toBe(
      "session = ny (sweep must occur in asian)",
    );
  });
});

describe("11 — Opening Range Breakout + Retest", () => {
  const base: RowSpec[] = [
    { o: 100, h: 100.5, l: 99.5, c: 100.2, session: "london" },
    { o: 100.2, h: 100.6, l: 99.8, c: 100.4, session: "london" },
    { o: 100.4, h: 101.5, l: 100.4, c: 101.4, session: "london", displacement: "Yes" },
    { o: 101.4, h: 101.4, l: 100.5, c: 100.9, session: "london" },
  ];

  it("passes when the breakout is retested by a reliable candle", () => {
    const result = outcome(openingRange, base, 2);
    expect(result.result).toBe("PASS");
    // SL now sits beyond the retest extreme, never inside the entry.
    expect(result.sl).toBeCloseTo(100.5);
  });

  it("fails when the retest candle is unreliable", () => {
    const specs = structuredClone(base);
    specs[3]!.reliable = false;
    expect(outcome(openingRange, specs, 2).reason).toBe(
      "retest candle at +1 has is_reliable = false",
    );
  });
});

describe("12 — EMA 50/200 Pullback", () => {
  function trendingSeries(): RowSpec[] {
    const specs: RowSpec[] = [];
    for (let i = 0; i < 220; i++) {
      const price = 100 + i * 0.5;
      specs.push({ o: price, h: price + 0.4, l: price - 0.4, c: price + 0.3 });
    }
    return specs;
  }

  function withPullback(): { specs: RowSpec[]; index: number } {
    const specs = trendingSeries();
    const refs = [dtFor(214), dtFor(215), dtFor(216)];
    const last = specs.length - 1;
    // Deep wick down through EMA-50, closing back above it.
    specs[last] = { o: 205, h: 212, l: 190, c: 206, lower: 60, refs };
    return { specs, index: last };
  }

  it("passes on a trend-aligned pullback into EMA-50", () => {
    const { specs, index } = withPullback();
    const result = outcome(emaPullback, specs, index);
    expect(result.result).toBe("PASS");
    expect(result.reason).toContain("pullback to EMA-50");
  });

  it("fails when the rejection wick is under 45%", () => {
    const { specs, index } = withPullback();
    specs[index]!.lower = 20;
    expect(outcome(emaPullback, specs, index).reason).toBe("lower_wick_pct 20% below 45%");
  });
});

describe("13 — Swing Failure Pattern", () => {
  const base: RowSpec[] = [
    ...BULL_SWINGS,
    { o: 101.9, h: 103, l: 101.8, c: 102.5, upper: 60 },
    { o: 102.4, h: 102.6, l: 101.5, c: 101.7, upper: 60, refs: BULL_REFS },
  ];

  it("passes when a broken swing high fails within 1-2 candles", () => {
    const result = outcome(swingFailure, base, 4);
    expect(result.result).toBe("PASS");
    expect(result.side).toBe("short");
  });

  it("fails when the breaking wick is under 50%", () => {
    const specs = structuredClone(base);
    specs[3]!.upper = 10;
    specs[4]!.upper = 10;
    expect(outcome(swingFailure, specs, 4).reason).toContain("below 50% on failed break");
  });
});

describe("unresolved swing references", () => {
  it("is reported verbatim instead of being estimated", () => {
    const specs: RowSpec[] = [
      ...BULL_SWINGS,
      { o: 101.4, h: 101.6, l: 101, c: 101.5, body: 20, lower: 70, refs: [...BULL_REFS, "1999-01-01 00:00"] },
    ];
    expect(outcome(pinBar, specs, 3).reason).toBe(
      "INVALID: unresolved swing reference [1999-01-01 00:00]",
    );
  });
});

describe("registry", () => {
  it("exposes all 13 strategies with unique ids", () => {
    expect(STRATEGIES).toHaveLength(13);
    expect(new Set(STRATEGIES.map((s) => s.id)).size).toBe(13);
  });
});
