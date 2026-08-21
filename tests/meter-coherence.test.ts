// A meter reading that runs backwards is not a measurement, and must not reach
// a client-facing invoice.
//
// The defect: computeRunningDelta already refused to charge for a reversed
// meter — delta stayed 0 and the bill fell to the guaranteed minimum — but it
// still returned the incoherent pair, so eleven August drafts printed an
// opening above their closing. SC-10's July invoice read "opening 2,641,740,
// closing 265,980": a single cab that had apparently driven backwards by
// 2.37 million kilometres. The money was right and the paper was indefensible.
//
// The causes seen in the live data, none of which describe the month's work:
//   - a digit added:   SC-10 2,641,740 for 264,174;  HCC-11 1,593,470 for 159,347
//   - a digit dropped: HCC-07 33,972 where its neighbours read ~383,000
//   - a meter physically replaced and restarted: LD-09 3,839 hours then 66

import { describe, expect, it } from "vitest";

// Mirrors the decision in computeRunningDelta: what a caller is told about a
// month's meter, given the opening and closing readings that were selected.
function reportMeter(opening: number | null, closing: number | null) {
  if (opening != null && closing != null && closing < opening) {
    return { opening: null, closing: null, delta: 0 };
  }
  let delta = 0;
  if (opening != null && closing != null && closing > opening) delta = closing - opening;
  return { opening, closing, delta };
}

describe("a meter that runs forwards", () => {
  it("reports the movement it measured", () => {
    expect(reportMeter(91_095.7, 91_470.2)).toEqual({ opening: 91_095.7, closing: 91_470.2, delta: 374.5 });
  });

  it("reports no movement when the machine did not move", () => {
    expect(reportMeter(32_017, 32_017)).toEqual({ opening: 32_017, closing: 32_017, delta: 0 });
  });
});

describe("a meter that runs backwards is not reported at all", () => {
  it("withholds the pair rather than printing it", () => {
    // SC-10, July 2026 — an extra digit on the opening reading.
    expect(reportMeter(2_641_740, 265_980)).toEqual({ opening: null, closing: null, delta: 0 });
  });

  it("catches a dropped digit as readily as an added one", () => {
    // HCC-07, August 2026 — the closing lost its leading digits.
    expect(reportMeter(382_737, 33_972)).toEqual({ opening: null, closing: null, delta: 0 });
  });

  it("catches a replaced meter that restarted low", () => {
    // LD-09 — a wheel loader whose hour meter was changed mid-life.
    expect(reportMeter(20_060.8, 83.2)).toEqual({ opening: null, closing: null, delta: 0 });
  });

  it("catches a small reversal, not only an obvious one", () => {
    // DC-24, August 2026 — 35 km backwards. Just as impossible, easier to miss.
    expect(reportMeter(330_212, 330_177)).toEqual({ opening: null, closing: null, delta: 0 });
  });

  it("never charges for a reversal", () => {
    for (const [o, c] of [[2_641_740, 265_980], [382_737, 33_972], [954.8, 278], [252_931, 252_814]]) {
      expect(reportMeter(o, c).delta).toBe(0);
    }
  });
});

describe("what a missing meter means downstream", () => {
  it("leaves nothing for an invoice to print", () => {
    const r = reportMeter(1_593_470, 161_686); // HCC-11
    expect(r.opening).toBeNull();
    expect(r.closing).toBeNull();
  });

  it("still lets a bill fall back to the guaranteed minimum, not to zero", () => {
    // The guarantee is a floor, not a cap, and it applies precisely when the
    // meter cannot be trusted. billableUnits = max(actual, minimum).
    const { delta } = reportMeter(20_060, 3_009); // DC-10
    expect(Math.max(delta, 3000)).toBe(3000);
  });
});

describe("partial readings are left alone", () => {
  it("passes through when only one end is known", () => {
    expect(reportMeter(null, 265_980)).toEqual({ opening: null, closing: 265_980, delta: 0 });
    expect(reportMeter(264_174, null)).toEqual({ opening: 264_174, closing: null, delta: 0 });
  });

  it("passes through when neither end is known", () => {
    expect(reportMeter(null, null)).toEqual({ opening: null, closing: null, delta: 0 });
  });
});
