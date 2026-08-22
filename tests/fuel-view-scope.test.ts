// Who may read which fuel issues.
//
// The rule this replaces treated WORKSHOP as a privileged role, on the reasoning
// that a workshop pump fuels vehicles from every site. It does — but that is a
// fact about who they may FUEL, not about whose fuel book they may READ. One
// operator could open every site's diesel, and the site pumps were scoped the
// wrong way round besides: by the vehicle's posting, which hid the visiting
// machines they had actually fuelled and showed them their own site's lorries
// filling up at other yards.
//
// A pump operator's scope is their pump. A site login that works no pump keeps
// the allocation view, because that is the figure on its bill. Anything that
// cannot be resolved gets nothing.

import { describe, expect, it } from "vitest";
import { resolveFuelViewScope } from "../src/lib/fuel/view-scope";
import { reportFilterForScope } from "../src/lib/reports/fuel-issue-report";

const BGP = "proj-badalgama";
const CEP = "proj-cep03e";
const RUWA = "proj-ruwanwella";

describe("privileged roles", () => {
  it("gives ADMIN the whole estate", () => {
    expect(resolveFuelViewScope("ADMIN", null, null)).toEqual({ kind: "all" });
  });

  it("gives ALLOCATOR the whole estate", () => {
    expect(resolveFuelViewScope("ALLOCATOR", null, null)).toEqual({ kind: "all" });
  });

  it("does not narrow an admin who happens to hold a tank", () => {
    expect(resolveFuelViewScope("ADMIN", null, BGP)).toEqual({ kind: "all" });
  });
});

describe("pump operators are scoped by their pump", () => {
  it("scopes the workshop operator to their tank's site", () => {
    // chamila works the Badalgama Tank and carries no site posting at all —
    // exactly the case that used to fall through to "see everything".
    expect(resolveFuelViewScope("WORKSHOP", null, BGP)).toEqual({ kind: "pump", projectId: BGP });
  });

  it("scopes a site pump operator to their tank's site", () => {
    expect(resolveFuelViewScope("SITE_PUMP", CEP, CEP)).toEqual({ kind: "pump", projectId: CEP });
  });

  it("prefers the tank's site over the posting on the user record", () => {
    // The tank is the firmer fact: it is the thing the operator signs for.
    expect(resolveFuelViewScope("SITE_PUMP", CEP, BGP)).toEqual({ kind: "pump", projectId: BGP });
  });

  it("falls back to the user's site when they hold no tank", () => {
    // priyankara is posted to Ruwanwella with no tank linked.
    expect(resolveFuelViewScope("SITE_PUMP", RUWA, null)).toEqual({ kind: "pump", projectId: RUWA });
  });

  it("gives nothing to a pump role with neither tank nor site", () => {
    expect(resolveFuelViewScope("SITE_PUMP", null, null)).toEqual({ kind: "none" });
    expect(resolveFuelViewScope("WORKSHOP", null, null)).toEqual({ kind: "none" });
  });
});

describe("a site login without a pump keeps the allocation view", () => {
  it("scopes USER to their own site", () => {
    expect(resolveFuelViewScope("USER", CEP, null)).toEqual({ kind: "allocation", projectId: CEP });
  });

  it("fails closed when the site was never set", () => {
    // The shape that leaked before: "narrow the query IF the user has a site".
    expect(resolveFuelViewScope("USER", null, null)).toEqual({ kind: "none" });
  });
});

describe("anything unrecognised gets nothing", () => {
  it("refuses an empty role", () => {
    expect(resolveFuelViewScope(null, CEP, CEP)).toEqual({ kind: "none" });
    expect(resolveFuelViewScope(undefined, CEP, CEP)).toEqual({ kind: "none" });
  });

  it("refuses a role invented later", () => {
    expect(resolveFuelViewScope("AUDITOR", CEP, CEP)).toEqual({ kind: "none" });
  });
});

describe("the scope reaches the report, the PDF and the Excel identically", () => {
  it("asks the pump question for a pump operator", () => {
    const f = reportFilterForScope({ kind: "pump", projectId: BGP });
    expect(f).toEqual({ pumpProjectId: BGP });
    expect(f.projectId).toBeUndefined();
  });

  it("asks the allocation question for a site login", () => {
    expect(reportFilterForScope({ kind: "allocation", projectId: CEP })).toEqual({ projectId: CEP });
  });

  it("ignores a site typed into the query string by a scoped reader", () => {
    // /api/fuel/report/xlsx?site=<somewhere else> is a URL anyone can type.
    expect(reportFilterForScope({ kind: "pump", projectId: BGP }, CEP)).toEqual({ pumpProjectId: BGP });
    expect(reportFilterForScope({ kind: "allocation", projectId: CEP }, BGP)).toEqual({ projectId: CEP });
    expect(reportFilterForScope({ kind: "none" }, CEP)).toEqual({ none: true });
  });

  it("honours the site an entitled reader picked", () => {
    expect(reportFilterForScope({ kind: "all" }, CEP)).toEqual({ projectId: CEP });
    expect(reportFilterForScope({ kind: "all" })).toEqual({ projectId: undefined });
  });
});
