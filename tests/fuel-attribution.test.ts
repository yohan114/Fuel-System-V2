import { describe, it, expect } from "vitest";
import {
  sourceToProjectCode,
  attributeSegmentFuel,
  type FuelIssueLite,
  type SegShare,
} from "../src/lib/billing/fuel-attribution";

describe("sourceToProjectCode", () => {
  it("maps site-tagged register sources to their project code", () => {
    expect(sourceToProjectCode("Consolidated register (Marawila)")).toBe("MARA");
    expect(sourceToProjectCode("Consolidated register (Lot 04)")).toBe("LOT-04");
    expect(sourceToProjectCode("Consolidated register (Lot 02)")).toBe("BATTI-02");
    expect(sourceToProjectCode("Consolidated register (Ruwanwella)")).toBe("RWP");
    expect(sourceToProjectCode("Consolidated register (Inginimitiya)")).toBe("INGI");
    expect(sourceToProjectCode("Consolidated register (Karaitivu Bridge)")).toBe("KB");
    expect(sourceToProjectCode("Consolidated register (Muthur Plant)")).toBe("MUTHUR");
    expect(sourceToProjectCode("Consolidated register (Galagedara)")).toBe("CEP-03F");
    expect(sourceToProjectCode("Consolidated register (Avissawella)")).toBe("AVIS");
    expect(sourceToProjectCode("Consolidated register (Ambanpola)")).toBe("AMB");
    expect(sourceToProjectCode("Consolidated register (Pallanoya Bridge)")).toBe("PNB");
  });

  it("maps the CEP-03 sub-packages without collision", () => {
    expect(sourceToProjectCode("CEP-03 ABC monthly summary")).toBe("CEP-03-ABC");
    expect(sourceToProjectCode("Consolidated register (CEP-03 E Package)")).toBe("CEP-03 E");
    expect(sourceToProjectCode("CEP-03 E live db (add-only)")).toBe("CEP-03 E");
    expect(sourceToProjectCode("Consolidated register (Galagedara)")).toBe("CEP-03F");
  });

  it("returns null for the shared Badalgama pump and unknowns", () => {
    expect(sourceToProjectCode("Badalgama app.db (Mar-Jun 2026)")).toBeNull();
    expect(sourceToProjectCode("Wastage Fuels")).toBeNull();
    expect(sourceToProjectCode("")).toBeNull();
    expect(sourceToProjectCode(null)).toBeNull();
    expect(sourceToProjectCode("Some unmapped station")).toBeNull();
  });
});

describe("attributeSegmentFuel (total-preserving per-site redistribution)", () => {
  const seg = (projectCode: string, days: number): SegShare => ({ projectCode, days });
  const iss = (litres: number, source: string | null): FuelIssueLite => ({ litres, costCents: Math.round(litres * 30000), source });

  const sum = (arr: { litres: number; costCents: number }[]) => ({
    litres: arr.reduce((s, o) => s + o.litres, 0),
    costCents: arr.reduce((s, o) => s + o.costCents, 0),
  });

  it("empty segments → empty result", () => {
    expect(attributeSegmentFuel([], [], 0, 0)).toEqual([]);
  });

  it("single segment gets the whole pot unchanged", () => {
    const out = attributeSegmentFuel([iss(100, "Badalgama app.db")], [seg("LOT-04", 30)], 100, 3_000_000);
    expect(out).toEqual([{ litres: 100, costCents: 3_000_000 }]);
  });

  it("attributes fuel to the site it was sourced from", () => {
    // 300 L: 200 L sourced to KB, 100 L sourced to Lot-04. Two equal-day segments.
    const issues = [iss(200, "Consolidated register (Karaitivu Bridge)"), iss(100, "Consolidated register (Lot 04)")];
    const segs = [seg("KB", 15), seg("LOT-04", 15)];
    const out = attributeSegmentFuel(issues, segs, 300, 9_000_000);
    expect(out[0].litres).toBeCloseTo(200, 6);
    expect(out[1].litres).toBeCloseTo(100, 6);
    // Total is exactly preserved.
    expect(sum(out).litres).toBeCloseTo(300, 9);
    expect(sum(out).costCents).toBe(9_000_000);
  });

  it("folds shared-pump (Badalgama) residual by day-share", () => {
    // All 300 L from the shared pump → no site source → folded 20/10 by days.
    const issues = [iss(300, "Badalgama app.db (Mar-Jun 2026)")];
    const segs = [seg("KB", 20), seg("LOT-04", 10)];
    const out = attributeSegmentFuel(issues, segs, 300, 9_000_000);
    expect(out[0].litres).toBeCloseTo(200, 6); // 20/30 of 300
    expect(out[1].litres).toBeCloseTo(100, 6); // 10/30 of 300
    expect(sum(out).litres).toBeCloseTo(300, 9);
    expect(sum(out).costCents).toBe(9_000_000);
  });

  it("mixes sourced + residual: KB source plus shared-pump folded by days", () => {
    // 100 L KB-sourced, 200 L shared pump. Days KB 20 / LOT-04 10.
    // KB target = 100 + 200*(20/30) = 233.33 ; LOT-04 = 200*(10/30) = 66.67.
    const issues = [iss(100, "Consolidated register (Karaitivu Bridge)"), iss(200, "Badalgama app.db")];
    const segs = [seg("KB", 20), seg("LOT-04", 10)];
    const out = attributeSegmentFuel(issues, segs, 300, 9_000_000);
    expect(out[0].litres).toBeCloseTo(233.333, 2);
    expect(out[1].litres).toBeCloseTo(66.667, 2);
    expect(sum(out).litres).toBeCloseTo(300, 9);
    expect(sum(out).costCents).toBe(9_000_000);
  });

  it("fuel sourced to a NON-bill site is treated as residual", () => {
    // Vehicle billed at KB + LOT-04, but a Marawila-sourced issue appears.
    const issues = [iss(300, "Consolidated register (Marawila)")];
    const segs = [seg("KB", 15), seg("LOT-04", 15)];
    const out = attributeSegmentFuel(issues, segs, 300, 9_000_000);
    // Marawila is not a bill site → residual → folded 50/50.
    expect(out[0].litres).toBeCloseTo(150, 6);
    expect(out[1].litres).toBeCloseTo(150, 6);
    expect(sum(out).litres).toBeCloseTo(300, 9);
  });

  it("splits one site's fuel across its own multiple segments by day-share", () => {
    // Vehicle: KB (10d), LOT-04 (10d), then KB again (10d). All fuel KB-sourced.
    const issues = [iss(300, "Consolidated register (Karaitivu Bridge)")];
    const segs = [seg("KB", 10), seg("LOT-04", 10), seg("KB", 10)];
    const out = attributeSegmentFuel(issues, segs, 300, 9_000_000);
    // KB total = 300, split across its two 10-day segments = 150 each; LOT-04 = 0.
    expect(out[0].litres).toBeCloseTo(150, 4);
    expect(out[1].litres).toBeCloseTo(0, 6);
    expect(out[2].litres).toBeCloseTo(150, 4);
    expect(sum(out).litres).toBeCloseTo(300, 9);
    expect(sum(out).costCents).toBe(9_000_000);
  });

  it("preserves an odd cent pot exactly (residual absorbed by largest segment)", () => {
    const issues = [iss(100, "Consolidated register (Karaitivu Bridge)"), iss(200, "Badalgama app.db")];
    const segs = [seg("KB", 7), seg("LOT-04", 13)];
    const potCents = 1_234_567; // deliberately not divisible
    const out = attributeSegmentFuel(issues, segs, 333.333, potCents);
    expect(sum(out).costCents).toBe(potCents); // exact to the cent
    expect(sum(out).litres).toBeCloseTo(333.333, 6);
  });

  it("zero pot → all zeros", () => {
    const out = attributeSegmentFuel([], [seg("KB", 15), seg("LOT-04", 15)], 0, 0);
    expect(sum(out).litres).toBe(0);
    expect(sum(out).costCents).toBe(0);
  });
});
