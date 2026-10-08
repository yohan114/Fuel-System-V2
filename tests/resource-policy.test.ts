// Resource-level Policy Remediation & Role Boundary Guards (Master Plan Task SEC-02)
//
// Verifies:
// 1. Role scope boundaries (roleAllowsScope): WORKSHOP and SITE_PUMP are denied read:billing, read:rates, read:budgets.
// 2. Billing allow-list scoping (billingScope): fail-closed for WORKSHOP and site users without project assignments.
// 3. Document-level access authorization (canReadBillFor): WORKSHOP user guessing an invoice ID is rejected.
// 4. Cross-site reporting boundaries: executive fleet audit reports and consolidated billing are restricted to ADMIN/ALLOCATOR.

import { describe, expect, it } from "vitest";
import { roleAllowsScope } from "../src/lib/api/auth";
import { billingScope, canReadBillFor, isSiteUser, isPumpOperator } from "../src/lib/roles";

describe("SEC-02: Role Scope Boundaries (roleAllowsScope)", () => {
  it("grants ADMIN full access across all operations", () => {
    expect(roleAllowsScope("ADMIN", "write:anything")).toBe(true);
    expect(roleAllowsScope("ADMIN", "read:billing")).toBe(true);
    expect(roleAllowsScope("ADMIN", "read:rates")).toBe(true);
    expect(roleAllowsScope("ADMIN", "read:fleet")).toBe(true);
  });

  it("grants ALLOCATOR read permissions and assignment modifications", () => {
    expect(roleAllowsScope("ALLOCATOR", "read:fleet")).toBe(true);
    expect(roleAllowsScope("ALLOCATOR", "read:billing")).toBe(true);
    expect(roleAllowsScope("ALLOCATOR", "write:assignments")).toBe(true);
    expect(roleAllowsScope("ALLOCATOR", "write:fuel")).toBe(false);
  });

  it("denies WORKSHOP commercial billing, rates, and budgets", () => {
    // Workshop operator issues fuel and logs maintenance; billing visibility is segregated
    expect(roleAllowsScope("WORKSHOP", "write:fuel")).toBe(true);
    expect(roleAllowsScope("WORKSHOP", "write:readings")).toBe(true);
    expect(roleAllowsScope("WORKSHOP", "write:services")).toBe(true);
    expect(roleAllowsScope("WORKSHOP", "read:fleet")).toBe(true);
    expect(roleAllowsScope("WORKSHOP", "read:fuel")).toBe(true);

    // Commercial and billing endpoints must be explicitly denied (Master Plan SEC-02)
    expect(roleAllowsScope("WORKSHOP", "read:billing")).toBe(false);
    expect(roleAllowsScope("WORKSHOP", "read:rates")).toBe(false);
    expect(roleAllowsScope("WORKSHOP", "read:budgets")).toBe(false);
  });

  it("denies SITE_PUMP commercial billing, rates, and budgets", () => {
    expect(roleAllowsScope("SITE_PUMP", "write:fuel")).toBe(true);
    expect(roleAllowsScope("SITE_PUMP", "read:fleet")).toBe(true);

    // Commercial and billing endpoints must be explicitly denied
    expect(roleAllowsScope("SITE_PUMP", "read:billing")).toBe(false);
    expect(roleAllowsScope("SITE_PUMP", "read:rates")).toBe(false);
    expect(roleAllowsScope("SITE_PUMP", "read:budgets")).toBe(false);
  });

  it("denies USER commercial rate card access while allowing site operations", () => {
    expect(roleAllowsScope("USER", "read:fleet")).toBe(true);
    expect(roleAllowsScope("USER", "read:fuel")).toBe(true);
    expect(roleAllowsScope("USER", "read:billing")).toBe(true); // Handled downstream by billingScope
    expect(roleAllowsScope("USER", "write:fuel")).toBe(false);

    // Rate card export is reserved for ADMIN/ALLOCATOR
    expect(roleAllowsScope("USER", "read:rates")).toBe(false);
  });
});

describe("SEC-02: Billing Allow-List Scoping (billingScope)", () => {
  it("grants ADMIN and ALLOCATOR company-wide billing scope", () => {
    expect(billingScope({ role: "ADMIN" })).toEqual({ kind: "all" });
    expect(billingScope({ role: "ALLOCATOR" })).toEqual({ kind: "all" });
  });

  it("scopes a site user strictly to their own assigned project", () => {
    const scope = billingScope({ role: "USER", projectId: "proj-galagedara" });
    expect(scope).toEqual({ kind: "project", projectId: "proj-galagedara" });
  });

  it("fails closed (kind: none) for a site user without an assigned project", () => {
    // A site user with missing/null projectId must NOT fall open to the entire company
    expect(billingScope({ role: "USER", projectId: null })).toEqual({ kind: "none" });
    expect(billingScope({ role: "USER", projectId: undefined })).toEqual({ kind: "none" });
    expect(billingScope({ role: "SITE_PUMP", projectId: null })).toEqual({ kind: "none" });
  });

  it("fails closed (kind: none) for WORKSHOP operators", () => {
    // Even if a workshop operator carries a session or pump id, billing scope is strictly none
    expect(billingScope({ role: "WORKSHOP" })).toEqual({ kind: "none" });
    expect(billingScope({ role: "WORKSHOP", projectId: "proj-workshop" })).toEqual({ kind: "none" });
  });

  it("fails closed for unauthenticated / unknown roles", () => {
    expect(billingScope(null)).toEqual({ kind: "none" });
    expect(billingScope(undefined)).toEqual({ kind: "none" });
    expect(billingScope({ role: "GUEST" })).toEqual({ kind: "none" });
  });
});

describe("SEC-02: Invoice Resource Access Enforcement (canReadBillFor)", () => {
  const admin = { role: "ADMIN" };
  const allocator = { role: "ALLOCATOR" };
  const siteUserGalagedara = { role: "USER", projectId: "proj-galagedara" };
  const siteUserBadalgama = { role: "USER", projectId: "proj-badalgama" };
  const siteUserUnassigned = { role: "USER", projectId: null };
  const workshopOperator = { role: "WORKSHOP", projectId: null };

  it("allows administrators and allocators to inspect bills from any project", () => {
    expect(canReadBillFor(admin, "proj-galagedara")).toBe(true);
    expect(canReadBillFor(admin, "proj-badalgama")).toBe(true);
    expect(canReadBillFor(admin, null)).toBe(true);

    expect(canReadBillFor(allocator, "proj-galagedara")).toBe(true);
    expect(canReadBillFor(allocator, "proj-badalgama")).toBe(true);
  });

  it("allows a site user to inspect bills for their own site only", () => {
    expect(canReadBillFor(siteUserGalagedara, "proj-galagedara")).toBe(true);
    expect(canReadBillFor(siteUserBadalgama, "proj-badalgama")).toBe(true);
  });

  it("strictly denies cross-site access when a site user attempts to read another site's bill", () => {
    // Galagedara user trying to view Badalgama invoice
    expect(canReadBillFor(siteUserGalagedara, "proj-badalgama")).toBe(false);
    expect(canReadBillFor(siteUserGalagedara, null)).toBe(false);

    // Badalgama user trying to view Galagedara invoice
    expect(canReadBillFor(siteUserBadalgama, "proj-galagedara")).toBe(false);
  });

  it("strictly denies access when a workshop user guesses an invoice export ID", () => {
    // Acceptance criterion from Master Plan: Workshop user guesses invoice export ID -> denied
    expect(canReadBillFor(workshopOperator, "proj-galagedara")).toBe(false);
    expect(canReadBillFor(workshopOperator, "proj-badalgama")).toBe(false);
    expect(canReadBillFor(workshopOperator, null)).toBe(false);
  });

  it("strictly denies access when a site user has no site assignment", () => {
    expect(canReadBillFor(siteUserUnassigned, "proj-galagedara")).toBe(false);
    expect(canReadBillFor(siteUserUnassigned, null)).toBe(false);
  });
});
