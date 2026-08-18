import { describe, expect, it } from "vitest";
import {
  checkServiceMeter,
  isAbsurd,
  isProgressing,
  meterDeltaUsable,
  withinReference,
} from "../src/lib/service/meter-trust";

describe("isAbsurd", () => {
  it("rejects the mis-keyed values found in the legacy service data", () => {
    expect(isAbsurd(15_651_010_099, "KM")).toBe(true); // DT-18
    expect(isAbsurd(6_436_714_469, "KM")).toBe(true);  // DT-08
    expect(isAbsurd(106_063_370, "HOURS")).toBe(true); // PC-02
  });

  it("accepts real readings", () => {
    expect(isAbsurd(190_753, "KM")).toBe(false);  // DT-43
    expect(isAbsurd(617_743, "KM")).toBe(false);  // HCC-04
    expect(isAbsurd(2_410, "HOURS")).toBe(false); // LB-01
  });

  it("rejects zero and negatives — a zero is not a reading", () => {
    expect(isAbsurd(0, "KM")).toBe(true);
    expect(isAbsurd(-5, "HOURS")).toBe(true);
  });
});

describe("withinReference", () => {
  it("accepts a reading in the same range as the fuel-issue meters", () => {
    expect(withinReference(617_743, 610_000, 620_000)).toBe(true);
  });

  it("rejects an order-of-magnitude difference", () => {
    // DT-43: service says 190,753 but fuel issues read ~28,600.
    expect(withinReference(190_753, 28_605, 29_086)).toBe(false);
  });

  it("tolerates small machines where doubling is a narrow band", () => {
    // A machine with only one low reading should still accept nearby values.
    expect(withinReference(1_200, 800, 800)).toBe(true);
  });
});

describe("isProgressing", () => {
  it("accepts a rising sequence", () => {
    expect(isProgressing([173_987, 183_258, 190_753])).toBe(true);
  });

  it("tolerates a single reset — a replaced meter", () => {
    expect(isProgressing([173_987, 183_258, 8_452])).toBe(true);
  });

  it("rejects readings that jump around", () => {
    expect(isProgressing([5_000, 200, 9_000, 300])).toBe(false);
  });

  it("accepts a single reading", () => {
    expect(isProgressing([1_156])).toBe(true);
  });
});

describe("checkServiceMeter", () => {
  it("trusts a reading consistent with the machine's fuel meters", () => {
    const r = checkServiceMeter({ value: 617_743, meterType: "KM", reference: { min: 610_000, max: 625_000 }, ownSequenceInDateOrder: [] });
    expect(r.trusted).toBe(true);
    expect(r.verdict).toBe("ok");
  });

  it("holds a second-meter reading rather than merging it", () => {
    const r = checkServiceMeter({ value: 190_753, meterType: "KM", reference: { min: 28_605, max: 29_086 }, ownSequenceInDateOrder: [] });
    expect(r.trusted).toBe(false);
    expect(r.verdict).toBe("scale-mismatch");
    expect(r.reason).toContain("second meter");
  });

  it("holds an absurd reading even when there is nothing to compare it to", () => {
    const r = checkServiceMeter({ value: 15_651_010_099, meterType: "KM", reference: null, ownSequenceInDateOrder: [] });
    expect(r.verdict).toBe("absurd");
  });

  it("trusts an unreferenced reading when the machine's own history progresses", () => {
    const r = checkServiceMeter({ value: 5_000, meterType: "HOURS", reference: null, ownSequenceInDateOrder: [3_000, 4_000, 5_000] });
    expect(r.trusted).toBe(true);
  });

  it("holds an unreferenced reading when the history is erratic", () => {
    const r = checkServiceMeter({ value: 300, meterType: "KM", reference: null, ownSequenceInDateOrder: [5_000, 200, 9_000, 300] });
    expect(r.trusted).toBe(false);
    expect(r.verdict).toBe("erratic");
  });
});

describe("meterDeltaUsable", () => {
  it("subtracts when both readings are the same instrument", () => {
    const r = meterDeltaUsable({ meterAtService: 617_743, currentMeter: 637_359, meterType: "KM" });
    expect(r.usable).toBe(true);
    expect(r.delta).toBe(19_616);
  });

  it("refuses to subtract across two different meters", () => {
    // DT-43 again: 190,753 at service against a 28,605 fuel-issue meter.
    const r = meterDeltaUsable({ meterAtService: 190_753, currentMeter: 28_605, meterType: "KM" });
    expect(r.usable).toBe(false);
    expect(r.delta).toBeNull();
  });

  it("refuses when the meter went backwards", () => {
    const r = meterDeltaUsable({ meterAtService: 30_000, currentMeter: 29_000, meterType: "KM" });
    expect(r.usable).toBe(false);
    expect(r.reason).toContain("backwards");
  });

  it("refuses when either reading is impossible", () => {
    expect(meterDeltaUsable({ meterAtService: 8_011_994, currentMeter: 9_000_000, meterType: "KM" }).usable).toBe(false);
  });

  it("returns no delta when there is no pair", () => {
    expect(meterDeltaUsable({ meterAtService: null, currentMeter: 5_000, meterType: "KM" }).usable).toBe(false);
  });
});
