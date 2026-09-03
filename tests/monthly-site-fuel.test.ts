import { describe, expect, it } from "vitest";
import { indexAssignments, type AssignmentSpan } from "../src/lib/fuel/site-attribution";
import { attributeIssue, excelSheetName } from "../src/lib/reports/monthly-site-fuel";
import { colomboDayKey } from "../src/lib/colombo-date";

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

// The site sheet gained a per-machine issue list and both identifiers. These
// guard the two things that were easy to get silently wrong when it did.
describe("MachineIssueRow day keys", () => {
  it("files an imported row under the Colombo day, not the UTC one", () => {
    // Imported issues are stored at Colombo midnight, which is 18:30Z the
    // evening before. Reading that with the host's zone puts a whole site's
    // 4 August work under the 3rd, and the sheet then disagrees with the
    // daily issue note it was typed from.
    expect(colomboDayKey(new Date("2026-08-03T18:30:00.000Z"))).toBe("2026-08-04");
    expect(colomboDayKey(new Date("2026-07-31T18:30:00.000Z"))).toBe("2026-08-01");
  });

  it("keeps a late-evening operator entry on the day the operator worked", () => {
    // 23:45 Colombo on the 12th is 18:15Z the same day — the one case where the
    // UTC date happens to agree, included so a future change that breaks the
    // first case but not this one is still caught.
    expect(colomboDayKey(new Date("2026-08-12T18:15:00.000Z"))).toBe("2026-08-12");
    // 00:30 Colombo on the 13th is 19:00Z on the 12th, and must NOT read as the 12th.
    expect(colomboDayKey(new Date("2026-08-12T19:00:00.000Z"))).toBe("2026-08-13");
  });

  it("orders a month's days as strings in the same order as dates", () => {
    // The issue lists are sorted by this key rather than by Date, so the key
    // has to be zero-padded — "2026-08-9" would sort after "2026-08-10".
    const keys = ["2026-08-09", "2026-08-10", "2026-08-02"].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(["2026-08-02", "2026-08-09", "2026-08-10"]);
    expect(colomboDayKey(new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-09");
  });
});
