import { describe, expect, it } from "vitest";
import { computeServiceCost, lineAmountCents } from "../src/lib/service/cost";

describe("lineAmountCents", () => {
  it("multiplies qty by unit price, rounded to cents", () => {
    expect(lineAmountCents(3.4, 100_000)).toBe(340_000); // 3.4 L × Rs 1000
    expect(lineAmountCents(1, 5_050)).toBe(5_050);
  });
  it("is zero when there is no price", () => {
    expect(lineAmountCents(5, null)).toBe(0);
    expect(lineAmountCents(5, undefined)).toBe(0);
  });
});

describe("computeServiceCost", () => {
  it("charges labour 15% and sundry 5% on parts (default), total adds manpower", () => {
    const r = computeServiceCost([
      { kind: "OIL", amountCents: 700_000 },
      { kind: "FILTER", amountCents: 300_000 },
      { kind: "MANPOWER", amountCents: 200_000 },
    ]);
    expect(r.lubricantCents).toBe(700_000);
    expect(r.filterCents).toBe(300_000);
    expect(r.partsCents).toBe(1_000_000);
    expect(r.manpowerCents).toBe(200_000);
    expect(r.labourCents).toBe(150_000); // 15% of parts
    expect(r.sundryCents).toBe(50_000); // 5% of parts
    expect(r.totalCents).toBe(1_400_000); // 1,000,000 + 200,000 + 150,000 + 50,000
  });

  it("labour/sundry are on parts only, not manpower", () => {
    const r = computeServiceCost([
      { kind: "FILTER", amountCents: 100_000 },
      { kind: "MANPOWER", amountCents: 900_000 },
    ]);
    expect(r.labourCents).toBe(15_000); // 15% of 100k parts, ignores manpower
    expect(r.sundryCents).toBe(5_000);
    expect(r.totalCents).toBe(100_000 + 900_000 + 15_000 + 5_000);
  });

  it("honours custom percentages", () => {
    const r = computeServiceCost([{ kind: "OIL", amountCents: 100_000 }], { labourPct: 0.2, sundryPct: 0.1 });
    expect(r.labourCents).toBe(20_000);
    expect(r.sundryCents).toBe(10_000);
    expect(r.totalCents).toBe(130_000);
  });

  it("rounds each charge to the nearest cent independently", () => {
    // parts 333 → labour 15% = 49.95 → 50; sundry 5% = 16.65 → 17
    const r = computeServiceCost([{ kind: "OIL", amountCents: 333 }]);
    expect(r.labourCents).toBe(50);
    expect(r.sundryCents).toBe(17);
    expect(r.totalCents).toBe(333 + 50 + 17);
  });

  it("is all zeros for an empty sheet", () => {
    const r = computeServiceCost([]);
    expect(r).toEqual({ lubricantCents: 0, filterCents: 0, partsCents: 0, manpowerCents: 0, labourCents: 0, sundryCents: 0, totalCents: 0 });
  });
});
