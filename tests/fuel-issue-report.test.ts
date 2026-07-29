import { describe, it, expect } from "vitest";
import { effectiveSiteId, parseRange, ymd } from "../src/lib/fuel/issue-report";
import { isWorkshopTank } from "../src/lib/fuel/workshop-pump";

describe("effectiveSiteId", () => {
  it("lets privileged roles pick any site, or all sites", () => {
    for (const role of ["ADMIN", "ALLOCATOR", "WORKSHOP"]) {
      expect(effectiveSiteId({ role, projectId: null }, "site-9")).toBe("site-9");
      expect(effectiveSiteId({ role, projectId: null }, null)).toBeNull();
    }
  });

  it("pins a site user to their own site even if they ask for another", () => {
    for (const role of ["USER", "SITE_PUMP"]) {
      expect(effectiveSiteId({ role, projectId: "mine" }, "someone-elses")).toBe("mine");
    }
  });

  // The scoping bug this guards against: a site user with no projectId used to
  // fall through as "unrestricted" and could see every site's fuel.
  it("fails closed for a site user with no site assigned", () => {
    for (const role of ["USER", "SITE_PUMP"]) {
      const id = effectiveSiteId({ role, projectId: null }, "any-site");
      expect(id).not.toBeNull();
      expect(id).toBe("__no_site__");
    }
  });
});

describe("parseRange", () => {
  it("parses an explicit range and covers the whole end day", () => {
    const { from, to } = parseRange("2026-03-01", "2026-03-31");
    expect(ymd(from)).toBe("2026-03-01");
    expect(ymd(to)).toBe("2026-03-31");
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it("defaults to the current calendar month when nothing is given", () => {
    const { from, to } = parseRange(null, null);
    const now = new Date();
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(now.getMonth());
    expect(to.getMonth()).toBe(now.getMonth());
    expect(to >= from).toBe(true);
  });

  it("falls back rather than producing an invalid range", () => {
    const { from, to } = parseRange("not-a-date", "also-bad");
    expect(isNaN(from.getTime())).toBe(false);
    expect(isNaN(to.getTime())).toBe(false);
  });
});

describe("isWorkshopTank", () => {
  it("identifies the Badalgama workshop pump in either word order", () => {
    expect(isWorkshopTank({ name: "Badalgama Workshop Tank" })).toBe(true);
    expect(isWorkshopTank({ name: "badalgama main workshop pump" })).toBe(true);
    expect(isWorkshopTank({ name: "Workshop - Badalgama" })).toBe(true);
  });

  it("does not mistake a site pump for the workshop pump", () => {
    // Badalgama also has a plant tank; it must stay grouped with the site pumps.
    expect(isWorkshopTank({ name: "Badalgama Plant Tank" })).toBe(false);
    expect(isWorkshopTank({ name: "CEP-03 E Package Tank" })).toBe(false);
    expect(isWorkshopTank({ name: "Head Office Tank" })).toBe(false);
  });
});
