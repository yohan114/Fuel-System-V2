import { describe, expect, it } from "vitest";
import { billClarifyReasons, type ClarifyInput } from "../src/lib/billing/clarify";

const base: ClarifyInput = {
  billingMode: "hourly",
  rateBasis: "w",
  fuelLitres: 100,
  fuelCostCents: 3_000_000,
  actualUnits: 150,
  actualMeterUnits: 150,
  derivedStandardUnits: 150,
  derivedFromFuel: false,
};

describe("billClarifyReasons", () => {
  it("passes a bill where chart and fuel agree and fuel is priced", () => {
    expect(billClarifyReasons(base)).toEqual([]);
  });

  it("flags a big meter-vs-fuel disagreement", () => {
    // fuel implies 300 hr, chart shows 150 → +100%
    const r = billClarifyReasons({ ...base, derivedStandardUnits: 300 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/Fuel implies/);
  });

  it("does not flag small disagreements within tolerance", () => {
    expect(billClarifyReasons({ ...base, derivedStandardUnits: 165 })).toEqual([]); // +10%
  });

  it("flags fuel issued but priced at Rs 0 on a wet basis", () => {
    const r = billClarifyReasons({ ...base, fuelCostCents: 0 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/priced at Rs 0/);
  });

  it("does not flag unpriced fuel on a dry basis (fuel isn't charged)", () => {
    expect(billClarifyReasons({ ...base, rateBasis: "d", fuelCostCents: 0 })).toEqual([]);
  });

  it("does not run the meter check on perday bills", () => {
    expect(billClarifyReasons({ ...base, billingMode: "perday", derivedStandardUnits: 999 })).toEqual([]);
  });

  it("can return both reasons at once", () => {
    expect(billClarifyReasons({ ...base, derivedStandardUnits: 400, fuelCostCents: 0 })).toHaveLength(2);
  });
});
