import { describe, expect, it } from "vitest";
import {
  checkServiceMeter,
  DISTRUSTED_SERVICE_METERS,
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

// A service meter the owner has ruled out by hand.
//
// DT-64 reads 39,883 km at its March 2023 service, then 3,367 / 11,060 / 19,499
// across 2024-25. checkServiceMeter passes that: isProgressing tolerates exactly
// one drop, because a replaced odometer legitimately restarts from a low figure.
// The arithmetic cannot tell a replaced meter from a wrong one — twenty-one
// machines in this fleet share the shape and most are genuine replacements
// (BD-05 265,102 km then 14,907; DT-32 94,434 then 6,786). So the exclusion is a
// named list, not a rule: catching DT-64 with a threshold would take those too.
//
// It has to live in the sync rather than on the record, because the sync
// rewrites ServiceRecord.meterAtService from WorkshopOne on every run — a local
// edit is undone within five minutes.
describe("service meters ruled out by hand", () => {
  it("lists WSO:8 with a reason", () => {
    expect(DISTRUSTED_SERVICE_METERS.has("WSO:8")).toBe(true);
    expect(DISTRUSTED_SERVICE_METERS.get("WSO:8")).toMatch(/DT-64/);
  });

  it("is needed because the trust check alone would accept the reading", () => {
    const verdict = checkServiceMeter({
      value: 39883,
      meterType: "KM",
      reference: null,
      ownSequenceInDateOrder: [39883, 3367, 11060, 19499],
    });
    expect(verdict.trusted).toBe(true);
    expect(verdict.verdict).toBe("ok");
  });

  it("still accepts a genuine meter replacement, which is why this is a list", () => {
    // BD-05: 265,102 km then a new odometer climbing 1,943 -> 14,907.
    const verdict = checkServiceMeter({
      value: 265102,
      meterType: "KM",
      reference: null,
      ownSequenceInDateOrder: [265102, 1943, 8210, 14907],
    });
    expect(verdict.trusted).toBe(true);
    expect(DISTRUSTED_SERVICE_METERS.has("WSO:804")).toBe(false);
  });
});
