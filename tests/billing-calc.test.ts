import { describe, expect, it } from "vitest";
import { computeTotals } from "../src/lib/billing/calc";

const base = {
  billingMode: "hourly" as const,
  rateBasis: "w" as const,
  rateCents: 500_00, // Rs 500/hr
  actualUnits: 150,
  minimumUnits: 120,
  fuelLitres: 100,
  fuelCostCents: 300_00,
  ssclRate: 0.025,
  vatRate: 0.18,
};

describe("computeTotals", () => {
  it("bills actual units when above the minimum", () => {
    const t = computeTotals(base);
    expect(t.billableUnits).toBe(150);
    expect(t.rentalAmountCents).toBe(150 * 500_00);
  });

  it("enforces the minimum-units guarantee", () => {
    const t = computeTotals({ ...base, actualUnits: 80 });
    expect(t.billableUnits).toBe(120);
    expect(t.rentalAmountCents).toBe(120 * 500_00);
  });

  it("charges fuel on wet bases and not on dry", () => {
    expect(computeTotals(base).fuelChargedCents).toBe(300_00);
    expect(computeTotals({ ...base, rateBasis: "fw" }).fuelChargedCents).toBe(300_00);
    expect(computeTotals({ ...base, rateBasis: "d" }).fuelChargedCents).toBe(0);
  });

  it("applies SSCL to the subtotal and VAT after SSCL", () => {
    const t = computeTotals(base);
    const subtotal = 150 * 500_00 + 300_00;
    const sscl = Math.round(subtotal * 0.025);
    const vat = Math.round((subtotal + sscl) * 0.18);
    expect(t.subtotalCents).toBe(subtotal);
    expect(t.ssclCents).toBe(sscl);
    expect(t.vatCents).toBe(vat);
    expect(t.grandTotalCents).toBe(subtotal + sscl + vat);
  });

  it("keeps money integral (cents are rounded, never fractional)", () => {
    const t = computeTotals({ ...base, actualUnits: 33.33, rateCents: 12345 });
    for (const v of [t.rentalAmountCents, t.ssclCents, t.vatCents, t.grandTotalCents]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
