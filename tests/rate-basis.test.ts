import { describe, expect, it } from "vitest";
import { resolveRateBasis, pickRateCents, basisFromBillingType } from "../src/lib/billing/rate";
import { computeTotals } from "../src/lib/billing/calc";

describe("resolveRateBasis (dry/wet precedence)", () => {
  it("an explicit basis already on the draft wins", () => {
    expect(resolveRateBasis("d", "w")).toBe("d");
    expect(resolveRateBasis("w", "d")).toBe("w");
    expect(resolveRateBasis("fw", null)).toBe("fw");
  });
  it("falls back to the vehicle default when no draft basis", () => {
    expect(resolveRateBasis(null, "d")).toBe("d");
    expect(resolveRateBasis(undefined, "fw")).toBe("fw");
  });
  it("falls back to Wet when neither is set or a value is invalid", () => {
    expect(resolveRateBasis(null, null)).toBe("w");
    expect(resolveRateBasis("", "")).toBe("w");
    expect(resolveRateBasis("bogus", "nope")).toBe("w");
  });
});

describe("basisFromBillingType (Dry/Wet allocation → rate basis)", () => {
  it("maps a WET allocation to the wet basis and DRY to the dry basis", () => {
    expect(basisFromBillingType("WET")).toBe("w");
    expect(basisFromBillingType("DRY")).toBe("d");
  });
  it("returns undefined when the allocation has no explicit type (fall back to the rate card)", () => {
    expect(basisFromBillingType(null)).toBeUndefined();
    expect(basisFromBillingType(undefined)).toBeUndefined();
    expect(basisFromBillingType("")).toBeUndefined();
    expect(basisFromBillingType("something")).toBeUndefined();
  });
  it("mirrors the generate.ts precedence — allocation type overrides the vehicle default", () => {
    // opts.basis ?? basisFromBillingType(alloc) ?? resolveRateBasis(existing, default)
    const forced = undefined; // no whole-run override
    const wetAlloc = forced ?? basisFromBillingType("WET") ?? resolveRateBasis(null, "d");
    const dryAlloc = forced ?? basisFromBillingType("DRY") ?? resolveRateBasis(null, "w");
    const noAlloc = forced ?? basisFromBillingType(null) ?? resolveRateBasis(null, "d");
    expect(wetAlloc).toBe("w"); // Wet allocation wins over a dry-default vehicle
    expect(dryAlloc).toBe("d"); // Dry allocation wins over a wet-default vehicle
    expect(noAlloc).toBe("d"); // untyped allocation → vehicle default (dry here)
  });
});

describe("dry hire picks the dry rate and drops fuel", () => {
  const rate: any = { equipType: "FLEET", hrWCents: 415_000, hrDCents: 335_000, hrFwCents: 500_000 };

  it("pickRateCents returns the dry tier for basis d", () => {
    expect(pickRateCents(rate, "hourly", "d")).toBe(335_000);
    expect(pickRateCents(rate, "hourly", "w")).toBe(415_000);
  });

  it("a dry bill charges rental at the dry rate with no fuel; wet includes fuel", () => {
    const common = { billingMode: "hourly" as const, actualUnits: 120, minimumUnits: 120, fuelLitres: 400, fuelCostCents: 165_770, ssclRate: 0.025, vatRate: 0.18 };
    const wet = computeTotals({ ...common, rateBasis: "w", rateCents: 415_000 });
    const dry = computeTotals({ ...common, rateBasis: "d", rateCents: 335_000 });

    expect(wet.rentalAmountCents).toBe(49_800_000);
    expect(wet.fuelChargedCents).toBe(165_770); // fuel billed on wet
    expect(wet.subtotalCents).toBe(49_800_000 + 165_770);

    expect(dry.rentalAmountCents).toBe(40_200_000); // dry rate
    expect(dry.fuelChargedCents).toBe(0); // no fuel on dry
    expect(dry.subtotalCents).toBe(40_200_000); // rental only
    expect(dry.grandTotalCents).toBeLessThan(wet.grandTotalCents);
  });
});
