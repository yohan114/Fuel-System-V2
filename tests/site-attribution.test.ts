import { describe, expect, it } from "vitest";
import { indexAssignments, assignedSiteOn, type AssignmentSpan } from "../src/lib/fuel/site-attribution";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Vehicle X: Wadakada 1–15 May, Badalgama 16–31 May, then Wadakada open-ended from June.
const spans: AssignmentSpan[] = [
  { assetId: "X", projectId: "WADAKADA", startDate: d("2026-05-01"), endDate: d("2026-05-15") },
  { assetId: "X", projectId: "BADALGAMA", startDate: d("2026-05-16"), endDate: d("2026-05-31") },
  { assetId: "X", projectId: "WADAKADA", startDate: d("2026-06-01"), endDate: null },
  { assetId: "Y", projectId: "MARA", startDate: d("2026-05-01"), endDate: null },
];

describe("assignedSiteOn", () => {
  const idx = indexAssignments(spans);

  it("attributes an issue to the assigned site on that day, not the pump", () => {
    // The point of the feature: fuel drawn at Badalgama on 10 May for a
    // Wadakada-posted vehicle belongs to Wadakada.
    expect(assignedSiteOn(idx, "X", d("2026-05-10"))).toBe("WADAKADA");
  });

  it("follows the posting when it changes mid-period", () => {
    expect(assignedSiteOn(idx, "X", d("2026-05-20"))).toBe("BADALGAMA");
    expect(assignedSiteOn(idx, "X", d("2026-06-15"))).toBe("WADAKADA");
  });

  it("respects inclusive span boundaries", () => {
    expect(assignedSiteOn(idx, "X", d("2026-05-15"))).toBe("WADAKADA");
    expect(assignedSiteOn(idx, "X", d("2026-05-16"))).toBe("BADALGAMA");
  });

  it("returns null before any assignment (caller falls back to current site)", () => {
    expect(assignedSiteOn(idx, "X", d("2026-04-30"))).toBeNull();
  });

  it("open-ended assignment covers all later days", () => {
    expect(assignedSiteOn(idx, "Y", d("2027-01-01"))).toBe("MARA");
  });

  it("unknown asset resolves to null", () => {
    expect(assignedSiteOn(idx, "Z", d("2026-05-10"))).toBeNull();
  });
});
