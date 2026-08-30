import { describe, it, expect } from "vitest";
import { resolveIssueAuthority } from "../src/lib/fuel/issue-authority";

const A = "tank-awissawella";
const B = "tank-badalgama";

describe("which pump a person may record fuel out of", () => {
  it("lets an admin name any pump — that is the whole point of the panel", () => {
    const r = resolveIssueAuthority({ role: "ADMIN", ownTankId: null, targetTankId: B });
    expect(r).toEqual({ allowed: true, tankId: B, reason: "admin-any-pump" });
  });

  it("uses the pump on the FORM, not the one hanging off the admin's login", () => {
    // The case that breaks it: an admin who also happens to hold a tank. If the
    // session won, the office would key Badalgama's paper sheets and silently
    // move Awissawella's stock.
    const r = resolveIssueAuthority({ role: "ADMIN", ownTankId: A, targetTankId: B });
    expect(r).toEqual({ allowed: true, tankId: B, reason: "admin-any-pump" });
  });

  it("lets an admin record a station purchase with no pump at all", () => {
    const r = resolveIssueAuthority({ role: "ADMIN", ownTankId: null, targetTankId: null });
    expect(r).toEqual({ allowed: true, tankId: null, reason: "no-pump" });
  });

  it("holds an operator to the pump they signed for", () => {
    for (const role of ["WORKSHOP", "SITE_PUMP"]) {
      expect(resolveIssueAuthority({ role, ownTankId: A, targetTankId: A }))
        .toEqual({ allowed: true, tankId: A, reason: "own-pump" });
      // No target named — their own pump is the only answer.
      expect(resolveIssueAuthority({ role, ownTankId: A, targetTankId: null }))
        .toEqual({ allowed: true, tankId: A, reason: "own-pump" });
    }
  });

  it("refuses an operator who names somebody else's pump", () => {
    // The attack the ?tank= parameter would otherwise open: a site operator
    // editing the address bar to draw down another site's stock.
    for (const role of ["WORKSHOP", "SITE_PUMP"]) {
      const r = resolveIssueAuthority({ role, ownTankId: A, targetTankId: B });
      expect(r.allowed).toBe(false);
      expect("error" in r && r.error).toBe("You can only issue fuel from your own pump.");
    }
  });

  it("refuses an operator with no pump on their login", () => {
    // A pump operator whose tank was never allocated. Previously this fell
    // through to a console that looked ready and failed at submit.
    for (const own of [null, undefined, "", "   "]) {
      const r = resolveIssueAuthority({ role: "SITE_PUMP", ownTankId: own, targetTankId: A });
      expect(r.allowed, String(own)).toBe(false);
    }
  });

  it("refuses every role that does not work a pump", () => {
    // USER and ALLOCATOR both hold rights elsewhere in the system; neither
    // dispenses fuel. Checked with and without a named target.
    for (const role of ["USER", "ALLOCATOR", "", "UNKNOWN"]) {
      for (const target of [A, null]) {
        expect(resolveIssueAuthority({ role, ownTankId: A, targetTankId: target }).allowed, `${role}/${target}`).toBe(false);
      }
    }
    expect(resolveIssueAuthority({ role: null, ownTankId: A, targetTankId: A }).allowed).toBe(false);
    expect(resolveIssueAuthority({ role: undefined, ownTankId: A, targetTankId: A }).allowed).toBe(false);
  });

  it("treats whitespace as absent rather than as a tank id", () => {
    // A form posting an empty string must read as "no pump", not as a lookup
    // for a tank whose id is "".
    expect(resolveIssueAuthority({ role: "ADMIN", ownTankId: null, targetTankId: "   " }))
      .toEqual({ allowed: true, tankId: null, reason: "no-pump" });
    expect(resolveIssueAuthority({ role: "SITE_PUMP", ownTankId: "  ", targetTankId: A }).allowed).toBe(false);
  });

  it("never returns a tank id it was not given", () => {
    // Guards against a future edit that resolves "may they?" and "which one?"
    // separately and lets them disagree.
    const cases = [
      { role: "ADMIN", ownTankId: A, targetTankId: B },
      { role: "ADMIN", ownTankId: null, targetTankId: null },
      { role: "WORKSHOP", ownTankId: A, targetTankId: A },
      { role: "SITE_PUMP", ownTankId: B, targetTankId: null },
    ];
    for (const c of cases) {
      const r = resolveIssueAuthority(c);
      if (r.allowed && r.tankId !== null) {
        expect([c.ownTankId, c.targetTankId]).toContain(r.tankId);
      }
    }
  });
});
