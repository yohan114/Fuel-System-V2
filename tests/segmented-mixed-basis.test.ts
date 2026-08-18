// A vehicle can be allocated Dry to one site and Wet to another inside one
// month. Each site must then be billed on the terms IT was allocated on.
//
// Before this was fixed, the site holding the vehicle for the most days set the
// basis for the whole bill: a machine Dry at site A for 24 days and Wet at site B
// for 7 charged site B nothing for its diesel, and printed "(D)" on site B's
// line. The litres were recorded on the bill header, so the fuel simply
// disappeared between the fuel book and the invoice.

import { describe, expect, it } from "vitest";
import { computeSegmentedTotals, type SegmentInput, type SegmentedConfig } from "../src/lib/billing/segmented";

const HOURLY_DRY = 200_000; // Rs 2,000/hr in cents
const HOURLY_WET = 300_000; // Rs 3,000/hr in cents

const cfg = (over: Partial<SegmentedConfig> = {}): SegmentedConfig => ({
  billingMode: "hourly",
  rateBasis: "d",
  rateCents: HOURLY_DRY,
  pickedRate: HOURLY_DRY,
  minimumUnits: 120,
  daysInMonth: 31,
  fuelConsTyp: null,
  fuelConsEcon: null,
  ssclRate: 0,
  vatRate: 0,
  breakdownDays: 0,
  workingDays: 0,
  ...over,
});

const seg = (over: Partial<SegmentInput> & { projectCode: string; days: number }): SegmentInput => ({
  projectId: `p-${over.projectCode}`,
  projectName: over.projectCode,
  rawUnits: 0,
  fuelLitres: 0,
  fuelCostCents: 0,
  ...over,
});

describe("a vehicle allocated Dry at one site and Wet at another", () => {
  // 24 days Dry at site A, 7 days Wet at site B, 200 L burnt at B.
  const segments: SegmentInput[] = [
    seg({ projectCode: "SITE-A", days: 24, rateBasis: "d", rateCents: HOURLY_DRY }),
    seg({ projectCode: "SITE-B", days: 7, rateBasis: "w", rateCents: HOURLY_WET, fuelLitres: 200, fuelCostCents: 6_000_000 }),
  ];
  // The bill-level basis is Dry — site A holds the vehicle for most of the month.
  const res = computeSegmentedTotals(segments, cfg());

  it("charges the Wet site for its fuel", () => {
    const fuelLines = res.lineItems.filter((l) => l.kind === "FUEL");
    expect(fuelLines).toHaveLength(1);
    expect(fuelLines[0].projectName).toBe("SITE-B");
    expect(fuelLines[0].amountCents).toBe(6_000_000);
    expect(res.fuelChargedCents).toBe(6_000_000);
  });

  it("charges the Dry site nothing for fuel", () => {
    const dryFuel = res.lineItems.filter((l) => l.kind === "FUEL" && l.projectName === "SITE-A");
    expect(dryFuel).toHaveLength(0);
  });

  it("prices each site on its own rate tier", () => {
    const rental = res.lineItems.filter((l) => l.kind === "RENTAL");
    const a = rental.find((l) => l.projectName === "SITE-A")!;
    const b = rental.find((l) => l.projectName === "SITE-B")!;
    expect(a.unitRateCents).toBe(HOURLY_DRY);
    expect(b.unitRateCents).toBe(HOURLY_WET);
  });

  it("labels each line with the basis that site was actually allocated on", () => {
    const rental = res.lineItems.filter((l) => l.kind === "RENTAL");
    expect(rental.find((l) => l.projectName === "SITE-A")!.description).toContain("(D)");
    expect(rental.find((l) => l.projectName === "SITE-B")!.description).toContain("(W)");
  });

  it("still records every litre on the header, charged or not", () => {
    expect(res.litresSum).toBe(200);
  });
});

describe("the reverse — Wet for most of the month, Dry for the rest", () => {
  const segments: SegmentInput[] = [
    seg({ projectCode: "SITE-A", days: 24, rateBasis: "w", rateCents: HOURLY_WET, fuelLitres: 300, fuelCostCents: 9_000_000 }),
    seg({ projectCode: "SITE-B", days: 7, rateBasis: "d", rateCents: HOURLY_DRY, fuelLitres: 100, fuelCostCents: 3_000_000 }),
  ];
  const res = computeSegmentedTotals(segments, cfg({ rateBasis: "w", rateCents: HOURLY_WET, pickedRate: HOURLY_WET }));

  it("charges only the Wet site's fuel, not the Dry site's", () => {
    expect(res.fuelChargedCents).toBe(9_000_000);
    const fuelLines = res.lineItems.filter((l) => l.kind === "FUEL");
    expect(fuelLines).toHaveLength(1);
    expect(fuelLines[0].projectName).toBe("SITE-A");
  });

  it("counts all 400 litres on the header", () => {
    expect(res.litresSum).toBe(400);
  });
});

describe("arrive mid-month, then a full month from the next one on", () => {
  // The owner's rule: the month a vehicle arrives is charged only for the days it
  // was there; every following whole month is charged the full monthly minimum,
  // with no one having to intervene. Proven live by HEX-26, which arrived at its
  // site on 5 July and billed 104.5 h of its 120 h guarantee that month, then the
  // full 120 h in August.
  const MIN = 120;

  const monthlyMinimumFor = (daysOnSite: number, daysInMonth: number) => {
    const res = computeSegmentedTotals(
      [seg({ projectCode: "SITE-A", days: daysOnSite })],
      cfg({ minimumUnits: MIN, daysInMonth })
    );
    return res.minimumUnitsProrated;
  };

  it("charges only the days present in the arrival month", () => {
    // Arrives 5 July: 27 of 31 days.
    expect(monthlyMinimumFor(27, 31)).toBeCloseTo(120 * (27 / 31), 6);
    expect(monthlyMinimumFor(27, 31)).toBeCloseTo(104.516, 3);
  });

  it("charges the FULL minimum the next month, automatically", () => {
    // August: present all 31 days, so the proration resolves to the whole guarantee.
    expect(monthlyMinimumFor(31, 31)).toBe(MIN);
    // And February, where the month is shorter but still complete.
    expect(monthlyMinimumFor(28, 28)).toBe(MIN);
  });

  it("goes back to prorating if the vehicle leaves part-way through a later month", () => {
    // Leaves on the 10th: 10 of 31 days.
    expect(monthlyMinimumFor(10, 31)).toBeCloseTo(120 * (10 / 31), 6);
  });

  it("matches the owner's worked example in rupees", () => {
    // Rs 300,000 monthly, January, arrives on the 11th = 21 billable days.
    const monthlyRateCents = 30_000_000;
    const prorated = Math.round((monthlyRateCents / 31) * 21);
    expect(prorated).toBe(20_322_581); // Rs 203,225.81
  });
});

describe("unchanged behaviour when every segment shares one basis", () => {
  it("bills a Wet month exactly as before", () => {
    // No per-segment basis given — both fall back to the bill-level basis.
    const segments: SegmentInput[] = [
      seg({ projectCode: "A", days: 20, fuelLitres: 100, fuelCostCents: 3_000_000 }),
      seg({ projectCode: "B", days: 11, fuelLitres: 50, fuelCostCents: 1_500_000 }),
    ];
    const res = computeSegmentedTotals(segments, cfg({ rateBasis: "w", rateCents: HOURLY_WET, pickedRate: HOURLY_WET }));
    expect(res.fuelChargedCents).toBe(4_500_000);
    expect(res.lineItems.filter((l) => l.kind === "FUEL")).toHaveLength(2);
    expect(res.lineItems.filter((l) => l.kind === "RENTAL").every((l) => l.unitRateCents === HOURLY_WET)).toBe(true);
  });

  it("bills a Dry month with no fuel charge at all", () => {
    const segments: SegmentInput[] = [
      seg({ projectCode: "A", days: 20, fuelLitres: 100, fuelCostCents: 3_000_000 }),
      seg({ projectCode: "B", days: 11, fuelLitres: 50, fuelCostCents: 1_500_000 }),
    ];
    const res = computeSegmentedTotals(segments, cfg());
    expect(res.fuelChargedCents).toBe(0);
    expect(res.lineItems.filter((l) => l.kind === "FUEL")).toHaveLength(0);
    expect(res.litresSum).toBe(150);
  });
});
