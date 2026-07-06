import { describe, expect, it } from "vitest";
import { computeSiteSplit, parseSegmentDays, type SplitLineItem } from "../src/lib/billing/site-split";

function rental(site: string, days: number, qty: number, amountCents: number): SplitLineItem {
  return {
    kind: "RENTAL",
    description: `Machine rental — ${site} · hourly (W) · ${days} day${days !== 1 ? "s" : ""}`,
    quantity: qty,
    amountCents,
    projectId: `id-${site}`,
    projectName: `${site} Site`,
  };
}
function fuel(site: string, litres: number, amountCents: number): SplitLineItem {
  return { kind: "FUEL", description: `Fuel issued — ${site} (Wet)`, quantity: litres, amountCents, projectId: `id-${site}`, projectName: `${site} Site` };
}

describe("parseSegmentDays", () => {
  it("reads the day count the engine embeds in rental descriptions", () => {
    expect(parseSegmentDays("Machine rental — MARA · hourly (W) · 18 days")).toBe(18);
    expect(parseSegmentDays("Machine rental — CEP-03 · hourly (W) · 1 day")).toBe(1);
    expect(parseSegmentDays("Machine rental — X · hourly (W) · 18 days [units incl. fuel]")).toBe(18);
  });
  it("is zero when no day count is present (legacy single-site lines)", () => {
    expect(parseSegmentDays("Machine rental (hourly, W)")).toBe(0);
  });
});

describe("computeSiteSplit", () => {
  it("returns null for single-site bills", () => {
    expect(computeSiteSplit([rental("MARA", 30, 120, 100_000), fuel("MARA", 100, 50_000)], 120)).toBeNull();
  });

  it("groups repeated postings to the same site and prorates the minimum by days", () => {
    // The user's example: two weeks + one week + one week (14/7/7 of 28 days)
    const split = computeSiteSplit([
      rental("A", 14, 60, 600_000),
      rental("B", 7, 30, 300_000),
      rental("C", 7, 30, 300_000),
      fuel("A", 100, 40_000),
    ], 120)!;
    expect(split.totalDays).toBe(28);
    const A = split.rows.find((r) => r.projectName === "A Site")!;
    const B = split.rows.find((r) => r.projectName === "B Site")!;
    expect(A.minShareUnits).toBeCloseTo(120 * (14 / 28)); // 60 hr guarantee
    expect(B.minShareUnits).toBeCloseTo(120 * (7 / 28)); // 30 hr
    expect(A.atMinimum).toBe(true); // billed exactly the guarantee
    expect(A.fuelLitres).toBe(100);
    expect(A.totalCents).toBe(640_000);
  });

  it("merges split postings (site A twice in one month) into one row", () => {
    const split = computeSiteSplit([
      rental("MARA", 18, 69.7, 212_516),
      rental("CEP", 1, 3.87, 11_806),
      rental("MARA", 12, 46.5, 141_677),
      fuel("MARA", 450, 176_400),
      fuel("CEP", 50, 19_600),
    ], 120)!;
    expect(split.rows).toHaveLength(2);
    const mara = split.rows[0]; // most days first
    expect(mara.projectName).toBe("MARA Site");
    expect(mara.days).toBe(30);
    expect(mara.billableUnits).toBeCloseTo(116.2);
    expect(mara.rentalCents).toBe(354_193);
    expect(mara.fuelCents).toBe(176_400);
    expect(split.totalDays).toBe(31);
  });

  it("flags above-guarantee sites as not at-minimum", () => {
    const split = computeSiteSplit([
      rental("A", 15, 90, 1), // guarantee would be 60
      rental("B", 15, 60, 1),
    ], 120)!;
    expect(split.rows.find((r) => r.projectName === "A Site")!.atMinimum).toBe(false);
    expect(split.rows.find((r) => r.projectName === "B Site")!.atMinimum).toBe(true);
  });
});
