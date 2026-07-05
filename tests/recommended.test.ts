import { describe, expect, it } from "vitest";
import {
  recommendedUnits,
  varianceFlag,
  formatVariancePct,
  VARIANCE_THRESHOLD,
} from "../src/lib/reports/recommended";

describe("recommendedUnits", () => {
  it("derives units from litres ÷ typical rate", () => {
    expect(recommendedUnits(100, 4)).toBe(25);
  });
  it("is null without a usable rate and 0 without fuel", () => {
    expect(recommendedUnits(100, null)).toBeNull();
    expect(recommendedUnits(100, 0)).toBeNull();
    expect(recommendedUnits(0, 4)).toBe(0);
  });
});

describe("varianceFlag", () => {
  it("stays OK within the tolerance band", () => {
    const { flag, variancePct } = varianceFlag(100, 110); // +10%
    expect(flag).toBe("OK");
    expect(variancePct).toBeCloseTo(0.1);
  });
  it("flags METER_LOW when fuel implies more running than recorded", () => {
    expect(varianceFlag(100, 100 * (1 + VARIANCE_THRESHOLD)).flag).toBe("METER_LOW");
  });
  it("flags METER_HIGH when the meter outruns the fuel", () => {
    expect(varianceFlag(150, 100).flag).toBe("METER_HIGH");
  });
  it("suppresses when there is nothing to compare against", () => {
    expect(varianceFlag(100, null)).toEqual({ variancePct: null, flag: "OK" });
  });
  it("guards the zero-meter division", () => {
    const { variancePct } = varianceFlag(0, 1700); // dead meter, real fuel
    expect(variancePct).toBe(1700);
  });
});

describe("formatVariancePct", () => {
  it("renders signed percentages inside the cap", () => {
    expect(formatVariancePct(0.37)).toBe("+37%");
    expect(formatVariancePct(-0.12)).toBe("-12%");
    expect(formatVariancePct(3.07)).toBe("+307%");
  });
  it("caps runaway values at ±999%", () => {
    expect(formatVariancePct(1700)).toBe("≥ +999%");
    expect(formatVariancePct(-1700)).toBe("≤ -999%");
  });
  it("passes null through", () => {
    expect(formatVariancePct(null)).toBeNull();
  });
});
