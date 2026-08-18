import { describe, expect, it } from "vitest";
import {
  buildBillSnapshot,
  parseBillSnapshot,
  summarizeRevisionDiff,
  type BillSnapshot,
  type SnapshotSourceBill,
} from "../src/lib/billing/revisions";

const baseBill: SnapshotSourceBill = {
  billingMode: "hourly",
  rateCents: 150_000,
  actualUnits: 100,
  minimumUnits: 200,
  billableUnits: 200,
  rentalAmountCents: 30_000_000,
  fuelLitres: 500,
  fuelCostCents: 15_000_000,
  subtotalCents: 45_000_000,
  ssclCents: 1_125_000,
  vatCents: 8_302_500,
  grandTotalCents: 54_427_500,
};

function snap(over: Partial<BillSnapshot> = {}): BillSnapshot {
  return { ...buildBillSnapshot(baseBill, []), ...over };
}

describe("buildBillSnapshot", () => {
  it("captures the money and unit fields plus mapped line items", () => {
    const s = buildBillSnapshot(baseBill, [
      { kind: "RENTAL", description: "Rental", quantity: 200, unit: "hr", unitRateCents: 150_000, amountCents: 30_000_000, projectName: "Site A" },
      { kind: "FUEL", description: "Fuel", quantity: 500, unit: "L", unitRateCents: 30_000, amountCents: 15_000_000 },
    ]);
    expect(s.grandTotalCents).toBe(54_427_500);
    expect(s.lineItems).toHaveLength(2);
    expect(s.lineItems[0].projectName).toBe("Site A");
    // line items without a projectName normalise to null
    expect(s.lineItems[1].projectName).toBeNull();
  });
});

describe("parseBillSnapshot", () => {
  it("round-trips a built snapshot", () => {
    const s = buildBillSnapshot(baseBill, [
      { kind: "RENTAL", description: "Rental", quantity: 200, unit: "hr", unitRateCents: 150_000, amountCents: 30_000_000 },
    ]);
    const parsed = parseBillSnapshot(JSON.stringify(s));
    expect(parsed).toEqual(s);
  });
  it("returns null for missing or malformed payloads", () => {
    expect(parseBillSnapshot(null)).toBeNull();
    expect(parseBillSnapshot("")).toBeNull();
    expect(parseBillSnapshot("{not json")).toBeNull();
    expect(parseBillSnapshot(JSON.stringify({ foo: 1 }))).toBeNull(); // no grandTotalCents
  });
  it("defaults absent line items to an empty array", () => {
    const parsed = parseBillSnapshot(JSON.stringify({ grandTotalCents: 100 }));
    expect(parsed?.lineItems).toEqual([]);
  });
});

describe("summarizeRevisionDiff", () => {
  it("is empty for an identical (no-op) regenerate", () => {
    expect(summarizeRevisionDiff(snap(), snap())).toEqual([]);
  });

  it("leads with the grand-total delta, signed", () => {
    const prev = snap({ grandTotalCents: 54_427_500 });
    const curr = snap({ grandTotalCents: 60_000_000 });
    const diff = summarizeRevisionDiff(prev, curr);
    expect(diff[0]).toContain("Grand total");
    expect(diff[0]).toContain("+Rs.");
  });

  it("renders a decrease with a minus sign", () => {
    const prev = snap({ grandTotalCents: 60_000_000 });
    const curr = snap({ grandTotalCents: 54_427_500 });
    expect(summarizeRevisionDiff(prev, curr)[0]).toContain("−Rs.");
  });

  it("ignores sub-display-precision float drift on recomputed units", () => {
    // A re-derived quantity can land a hair off; nothing that rounds the same
    // at 2 dp should surface as a change.
    const prev = snap({ billableUnits: 3000, actualUnits: 675, fuelLitres: 225 });
    const curr = snap({ billableUnits: 2999.9999997, actualUnits: 675.0000004, fuelLitres: 225 });
    expect(summarizeRevisionDiff(prev, curr)).toEqual([]);
  });

  it("reports unit, fuel and line-count changes", () => {
    const prev = snap({ billableUnits: 200, fuelLitres: 500, lineItems: [] });
    const curr = snap({
      billableUnits: 220,
      fuelLitres: 550,
      lineItems: [{ kind: "RENTAL", description: "r", quantity: 1, unit: "hr", unitRateCents: 0, amountCents: 0, projectName: null }],
    });
    const diff = summarizeRevisionDiff(prev, curr);
    expect(diff.some((d) => d.includes("Billable units"))).toBe(true);
    expect(diff.some((d) => d.includes("Fuel 500 L → 550 L"))).toBe(true);
    expect(diff.some((d) => d.includes("Line items 0 → 1"))).toBe(true);
  });
});
