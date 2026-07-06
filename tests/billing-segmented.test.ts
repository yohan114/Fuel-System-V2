import { describe, expect, it } from "vitest";
import { computeSegmentedTotals, sumChargedLineItems, type SegmentInput, type SegmentedConfig } from "../src/lib/billing/segmented";

// Golden multi-site scenarios with every money field hand-computed to the cent.
// SSCL = 2.5%, VAT = 18% (applied after SSCL) throughout.
const TAX = { ssclRate: 0.025, vatRate: 0.18 };

function cfg(over: Partial<SegmentedConfig>): SegmentedConfig {
  return {
    billingMode: "hourly", rateBasis: "w", rateCents: 50000, pickedRate: 50000,
    minimumUnits: 120, fuelConsTyp: null, fuelConsEcon: null,
    ...TAX, breakdownDays: 0, workingDays: 0, ...over,
  };
}

describe("computeSegmentedTotals — golden scenarios", () => {
  it("S1 · single site, meter above minimum, wet basis with fuel", () => {
    const segs: SegmentInput[] = [
      { projectId: "p1", projectName: "Site 1", projectCode: "S1", days: 30, rawUnits: 150, fuelLitres: 100, fuelCostCents: 3_000_000 },
    ];
    const r = computeSegmentedTotals(segs, cfg({}));
    // billable = max(150,120)=150; rental = 150*50000 = 7,500,000
    expect(r.rentalSum).toBe(7_500_000);
    expect(r.fuelChargedCents).toBe(3_000_000);
    expect(r.subtotalCents).toBe(10_500_000);
    expect(r.ssclCents).toBe(262_500); // 2.5%
    expect(r.vatCents).toBe(1_937_250); // 18% of 10,762,500
    expect(r.grandTotalCents).toBe(12_699_750);
    expect(r.lineItems.map((l) => l.kind)).toEqual(["RENTAL", "FUEL"]);
    expect(sumChargedLineItems(r.lineItems)).toBe(r.subtotalCents); // line items are the truth
  });

  it("S2 · two sites, minimum prorated by days, dry basis excludes fuel", () => {
    const segs: SegmentInput[] = [
      { projectId: "p1", projectName: "A", projectCode: "A", days: 8, rawUnits: 30, fuelLitres: 50, fuelCostCents: 1_000_000 },
      { projectId: "p2", projectName: "B", projectCode: "B", days: 12, rawUnits: 90, fuelLitres: 40, fuelCostCents: 800_000 },
    ];
    const r = computeSegmentedTotals(segs, cfg({ rateBasis: "d" }));
    // seg1 minShare=120*8/20=48 → billable max(30,48)=48 → 2,400,000
    // seg2 minShare=120*12/20=72 → billable max(90,72)=90 → 4,500,000
    expect(r.rentalSum).toBe(6_900_000);
    expect(r.fuelChargedCents).toBe(0); // dry
    expect(r.litresSum).toBe(90);
    expect(r.subtotalCents).toBe(6_900_000);
    expect(r.ssclCents).toBe(172_500);
    expect(r.vatCents).toBe(1_273_050); // 18% of 7,072,500
    expect(r.grandTotalCents).toBe(8_345_550);
    // dry ⇒ no FUEL lines, one RENTAL per site
    expect(r.lineItems.filter((l) => l.kind === "FUEL")).toHaveLength(0);
    expect(r.lineItems.filter((l) => l.kind === "RENTAL")).toHaveLength(2);
    expect(sumChargedLineItems(r.lineItems)).toBe(r.subtotalCents);
  });

  it("S3 · fuel-derived override when the meter reads far below the fuel", () => {
    const segs: SegmentInput[] = [
      { projectId: "p1", projectName: "A", projectCode: "A", days: 30, rawUnits: 20, fuelLitres: 1000, fuelCostCents: 2_000_000 },
    ];
    const r = computeSegmentedTotals(segs, cfg({ minimumUnits: 50, fuelConsTyp: 10 }));
    // dStd = 1000/10 = 100; |20-100|=80 > 10 ⇒ override to 100 (derived)
    expect(r.derivedFromFuel).toBe(true);
    expect(r.actualUnitsSum).toBe(100);
    // billable = max(100, 50) = 100 → 5,000,000
    expect(r.rentalSum).toBe(5_000_000);
    expect(r.subtotalCents).toBe(7_000_000); // +2,000,000 fuel
    expect(r.grandTotalCents).toBe(8_466_500);
    expect(r.lineItems[0].description).toContain("[units incl. fuel]");
    expect(sumChargedLineItems(r.lineItems)).toBe(r.subtotalCents);
  });

  it("S4 · hourly cap limits a single-segment month to 720 h", () => {
    const segs: SegmentInput[] = [
      { projectId: "p1", projectName: "A", projectCode: "A", days: 30, rawUnits: 900, fuelLitres: 0, fuelCostCents: 0 },
    ];
    const r = computeSegmentedTotals(segs, cfg({ rateBasis: "d" }));
    // maxSegHours = 720 * (30/30) = 720 ⇒ capped
    expect(r.actualUnitsSum).toBe(720);
    expect(r.billableSum).toBe(720);
    expect(r.rentalSum).toBe(36_000_000);
  });

  it("breakdown deduction is an informational negative line, not in the subtotal", () => {
    const segs: SegmentInput[] = [
      { projectId: "p1", projectName: "A", projectCode: "A", days: 26, rawUnits: 130, fuelLitres: 0, fuelCostCents: 0 },
    ];
    const r = computeSegmentedTotals(segs, cfg({ rateBasis: "d", breakdownDays: 4, workingDays: 26 }));
    const adj = r.lineItems.find((l) => l.kind === "ADJUSTMENT");
    expect(adj).toBeDefined();
    expect(adj!.amountCents).toBeLessThan(0);
    // subtotal excludes the adjustment — still equals the charged lines
    expect(sumChargedLineItems(r.lineItems)).toBe(r.subtotalCents);
    expect(r.breakdownDeductCents).toBeGreaterThan(0);
  });
});
