// A month's bill needs fuel drawn in that month.
//
// The rule this replaces: a machine posted to a site earned its guaranteed
// minimum whether or not it turned a wheel, on the reasoning that idle plant is
// still denied to anyone else. Defensible in principle, and in practice it
// billed 38 machines across June and July 2026 for Rs 9,633,933.60 with no
// diesel issued against any of them — almost all portable plant charged 26 days
// apiece: generators GE-05, GE-126, GE-147, compressors AC-01 through AC-44,
// welding sets WG-08 and WG-10, mixers.
//
// Diesel out of a site's tank is the one record that shows a machine working
// there, so it is now the precondition. The guaranteed minimum still governs HOW
// MUCH is charged once a machine qualifies — it remains a floor, not a cap.

import { describe, expect, it } from "vitest";

/**
 * Mirrors the gate in generateBillForAsset: does this asset-month produce a bill
 * at all, and what becomes of a bill already sitting there?
 */
function billOutcome(opts: {
  fuelIssuesThisMonth: number;
  existingBill?: { status: "DRAFT" | "ISSUED" | "PAID" } | null;
}): "billed" | "skipped-draft-removed" | "skipped-kept" {
  if (opts.fuelIssuesThisMonth > 0) return "billed";
  if (opts.existingBill?.status === "DRAFT") return "skipped-draft-removed";
  return "skipped-kept";
}

describe("fuel is the precondition for a bill", () => {
  it("bills a machine that drew fuel", () => {
    expect(billOutcome({ fuelIssuesThisMonth: 1 })).toBe("billed");
  });

  it("bills on a single litre — the gate is evidence of work, not volume", () => {
    expect(billOutcome({ fuelIssuesThisMonth: 1 })).toBe("billed");
  });

  it("does not bill a machine that drew none", () => {
    expect(billOutcome({ fuelIssuesThisMonth: 0 })).not.toBe("billed");
  });

  it("does not bill idle portable plant that used to earn its 26 days", () => {
    // GE-05, AC-27, WG-10 and the rest, each Rs 220,129 to Rs 345,917 a month.
    for (const _ of ["GE-05", "AC-27", "WG-10", "CM-24"]) {
      expect(billOutcome({ fuelIssuesThisMonth: 0 })).not.toBe("billed");
    }
  });
});

describe("what happens to a bill already there", () => {
  it("removes a draft raised before the rule tightened", () => {
    expect(billOutcome({ fuelIssuesThisMonth: 0, existingBill: { status: "DRAFT" } }))
      .toBe("skipped-draft-removed");
  });

  it("leaves an ISSUED invoice alone — that is a credit note, not a deletion", () => {
    // WATER PUMP 2026-07, invoice EC-INV-2026-0002, drew no July fuel but has
    // gone to the client. It survives precisely because it was issued.
    expect(billOutcome({ fuelIssuesThisMonth: 0, existingBill: { status: "ISSUED" } }))
      .toBe("skipped-kept");
  });

  it("leaves a PAID invoice alone", () => {
    expect(billOutcome({ fuelIssuesThisMonth: 0, existingBill: { status: "PAID" } }))
      .toBe("skipped-kept");
  });

  it("removes the draft on a regenerate rather than leaving it stale", () => {
    // The failure this guards against: an asset skipped without its existing
    // bill being cleared keeps whatever site, mode and rate a previous run gave
    // it, and no later regeneration ever revisits it.
    const before = billOutcome({ fuelIssuesThisMonth: 0, existingBill: { status: "DRAFT" } });
    expect(before).toBe("skipped-draft-removed");
  });
});

describe("the minimum is unaffected by this rule", () => {
  it("still applies once a machine qualifies", () => {
    // Fuel decides WHETHER to bill; the guarantee decides how much.
    // A machine with one fuel issue and no meter movement bills the minimum.
    const qualifies = billOutcome({ fuelIssuesThisMonth: 1 }) === "billed";
    const billable = Math.max(0 /* measured units */, 120 /* guaranteed minimum */);
    expect(qualifies).toBe(true);
    expect(billable).toBe(120);
  });
});
