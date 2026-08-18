import { describe, expect, it } from "vitest";
import { indexAssignments, type AssignmentSpan } from "../src/lib/fuel/site-attribution";
import { attributeIssue, excelSheetName } from "../src/lib/reports/monthly-site-fuel";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// DT-1 is posted to Wadakada for May, then nothing afterwards.
// DT-2 has never been posted anywhere.
const spans: AssignmentSpan[] = [
  { assetId: "DT-1", projectId: "WADAKADA", startDate: d("2026-05-01"), endDate: d("2026-05-31") },
];
const idx = indexAssignments(spans);
const tanks = new Map<string, string | null>([
  ["TANK-BADAL", "BADALGAMA"],
  ["TANK-ORPHAN", null], // tank not attached to any site
]);

describe("attributeIssue cascade", () => {
  it("uses the posting, not the pump, while a posting covers the day", () => {
    const r = attributeIssue(idx, tanks, {
      assetId: "DT-1", issueDate: d("2026-05-10"), bulkTankId: "TANK-BADAL", assetProjectId: "SOMEWHERE",
    });
    expect(r).toEqual({ projectId: "WADAKADA", rule: "posted" });
  });

  it("falls back to the tank's site once the posting no longer covers the day", () => {
    const r = attributeIssue(idx, tanks, {
      assetId: "DT-1", issueDate: d("2026-06-10"), bulkTankId: "TANK-BADAL", assetProjectId: "SOMEWHERE",
    });
    expect(r).toEqual({ projectId: "BADALGAMA", rule: "tank" });
  });

  it("uses the tank for a machine that has never been posted", () => {
    const r = attributeIssue(idx, tanks, {
      assetId: "DT-2", issueDate: d("2026-05-10"), bulkTankId: "TANK-BADAL", assetProjectId: null,
    });
    expect(r).toEqual({ projectId: "BADALGAMA", rule: "tank" });
  });

  it("falls back to the current site pointer when the tank has no site", () => {
    const r = attributeIssue(idx, tanks, {
      assetId: "DT-2", issueDate: d("2026-05-10"), bulkTankId: "TANK-ORPHAN", assetProjectId: "MARAWILA",
    });
    expect(r).toEqual({ projectId: "MARAWILA", rule: "current" });
  });

  it("reports unassigned rather than dropping an issue with no route at all", () => {
    const r = attributeIssue(idx, tanks, {
      assetId: "DT-2", issueDate: d("2026-05-10"), bulkTankId: null, assetProjectId: null,
    });
    expect(r).toEqual({ projectId: null, rule: "unassigned" });
  });

  it("respects inclusive posting boundaries", () => {
    const last = attributeIssue(idx, tanks, {
      assetId: "DT-1", issueDate: d("2026-05-31"), bulkTankId: "TANK-BADAL", assetProjectId: null,
    });
    expect(last.rule).toBe("posted");
    const next = attributeIssue(idx, tanks, {
      assetId: "DT-1", issueDate: d("2026-06-01"), bulkTankId: "TANK-BADAL", assetProjectId: null,
    });
    expect(next.rule).toBe("tank");
  });
});

describe("excelSheetName", () => {
  it("passes ordinary site names through", () => {
    const taken = new Set<string>();
    expect(excelSheetName("Badalgama Plant", taken)).toBe("Badalgama Plant");
    expect(excelSheetName("CEP-03 Wadakada", taken)).toBe("CEP-03 Wadakada");
  });

  it("strips characters Excel rejects in a tab name", () => {
    const taken = new Set<string>();
    expect(excelSheetName("CEP-03 A,B & C / Package", taken)).toBe("CEP-03 A,B & C Package");
    expect(excelSheetName("Site [North] *main*", taken)).toBe("Site North main");
  });

  it("truncates to Excel's 31-character limit", () => {
    const taken = new Set<string>();
    const out = excelSheetName("A very long construction site name that will not fit", taken);
    expect(out.length).toBeLessThanOrEqual(31);
  });

  it("keeps tabs unique, including when truncation collides", () => {
    const taken = new Set<string>();
    const a = excelSheetName("Marawila", taken);
    const b = excelSheetName("Marawila", taken);
    const c = excelSheetName("marawila", taken); // Excel treats names case-insensitively
    expect(a).toBe("Marawila");
    expect(b).toBe("Marawila (2)");
    expect(c).toBe("marawila (3)"); // deduped case-insensitively, caller's casing kept
    const long1 = excelSheetName("Inginimitiya Water Supply Project North", taken);
    const long2 = excelSheetName("Inginimitiya Water Supply Project South", taken);
    expect(long1).not.toBe(long2);
    expect(long2.length).toBeLessThanOrEqual(31);
  });

  it("never returns a blank tab name", () => {
    const taken = new Set<string>();
    expect(excelSheetName("", taken)).toBe("Site");
    expect(excelSheetName("///", taken)).toBe("Site (2)");
  });
});
