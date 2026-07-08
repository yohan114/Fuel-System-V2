import { describe, expect, it } from "vitest";
import { isSiteUser, isScopedSiteUser } from "../src/lib/roles";

describe("isSiteUser", () => {
  it("treats USER and SITE_PUMP as site-scoped", () => {
    expect(isSiteUser("USER")).toBe(true);
    expect(isSiteUser("SITE_PUMP")).toBe(true);
  });
  it("does not scope WORKSHOP, ADMIN or ALLOCATOR", () => {
    // WORKSHOP issues fuel across all sites; admins/allocators are unrestricted.
    expect(isSiteUser("WORKSHOP")).toBe(false);
    expect(isSiteUser("ADMIN")).toBe(false);
    expect(isSiteUser("ALLOCATOR")).toBe(false);
  });
  it("handles null/undefined/unknown roles safely", () => {
    expect(isSiteUser(null)).toBe(false);
    expect(isSiteUser(undefined)).toBe(false);
    expect(isSiteUser("WHATEVER")).toBe(false);
  });
});

describe("isScopedSiteUser", () => {
  it("requires both a site role and a concrete projectId", () => {
    expect(isScopedSiteUser({ role: "SITE_PUMP", projectId: "p1" })).toBe(true);
    expect(isScopedSiteUser({ role: "USER", projectId: "p1" })).toBe(true);
    expect(isScopedSiteUser({ role: "SITE_PUMP", projectId: null })).toBe(false);
    expect(isScopedSiteUser({ role: "WORKSHOP", projectId: "p1" })).toBe(false);
    expect(isScopedSiteUser(null)).toBe(false);
  });
});
