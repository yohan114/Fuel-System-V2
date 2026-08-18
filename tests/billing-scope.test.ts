// Who may read which invoices.
//
// The rule this replaced narrowed the query only IF the user was a site role AND
// had a site set — so it failed open twice: WORKSHOP is not a site role, so a
// workshop operator read every site's invoices and could download any invoice
// PDF; and a site login whose site had not been set fell through the same gap.
// The replacement is an allow-list: you are granted a scope, or you get nothing.

import { describe, expect, it } from "vitest";
import { billingScope, canReadBillFor } from "../src/lib/roles";

const SITE_A = "project-a";
const SITE_B = "project-b";

describe("billingScope", () => {
  it("gives administrators the whole company", () => {
    expect(billingScope({ role: "ADMIN", projectId: null })).toEqual({ kind: "all" });
  });

  it("gives allocators the whole company — they post vehicles across sites", () => {
    expect(billingScope({ role: "ALLOCATOR", projectId: null })).toEqual({ kind: "all" });
  });

  it("gives a site login exactly its own site", () => {
    expect(billingScope({ role: "SITE_PUMP", projectId: SITE_A })).toEqual({ kind: "project", projectId: SITE_A });
    expect(billingScope({ role: "USER", projectId: SITE_B })).toEqual({ kind: "project", projectId: SITE_B });
  });

  it("gives the workshop nothing — issuing fuel is not reading invoices", () => {
    // WORKSHOP is deliberately not site-scoped so it can fuel any vehicle. That
    // must not also hand it every site's financials.
    expect(billingScope({ role: "WORKSHOP", projectId: null })).toEqual({ kind: "none" });
    expect(billingScope({ role: "WORKSHOP", projectId: SITE_A })).toEqual({ kind: "none" });
  });

  it("gives a site login with no site set nothing, not everything", () => {
    expect(billingScope({ role: "SITE_PUMP", projectId: null })).toEqual({ kind: "none" });
    expect(billingScope({ role: "USER", projectId: undefined })).toEqual({ kind: "none" });
  });

  it("gives an unknown or missing role nothing", () => {
    expect(billingScope({ role: "SOMETHING_NEW", projectId: SITE_A })).toEqual({ kind: "none" });
    expect(billingScope(null)).toEqual({ kind: "none" });
    expect(billingScope({ role: null, projectId: SITE_A })).toEqual({ kind: "none" });
  });
});

describe("canReadBillFor", () => {
  it("lets an administrator read any bill, including unassigned ones", () => {
    expect(canReadBillFor({ role: "ADMIN" }, SITE_A)).toBe(true);
    expect(canReadBillFor({ role: "ADMIN" }, null)).toBe(true);
  });

  it("lets a site login read only its own site's bill", () => {
    const u = { role: "SITE_PUMP", projectId: SITE_A };
    expect(canReadBillFor(u, SITE_A)).toBe(true);
    expect(canReadBillFor(u, SITE_B)).toBe(false);
    // An unassigned bill belongs to no site, so no site login may read it.
    expect(canReadBillFor(u, null)).toBe(false);
  });

  it("refuses the workshop every bill", () => {
    expect(canReadBillFor({ role: "WORKSHOP", projectId: null }, SITE_A)).toBe(false);
    expect(canReadBillFor({ role: "WORKSHOP", projectId: null }, null)).toBe(false);
  });

  it("refuses a site login that has no site set", () => {
    expect(canReadBillFor({ role: "SITE_PUMP", projectId: null }, SITE_A)).toBe(false);
    expect(canReadBillFor({ role: "SITE_PUMP", projectId: null }, null)).toBe(false);
  });
});
