// Putting a vehicle on a site's bill by hand, and taking one off.
//
// The generator decides from the records — postings, fuel, rate cards — and is
// right nearly always. These are for when it is not, and the office knows
// something the records do not: a poker vibrator nobody ever registered, plant
// that stood on a client's site all month and burnt nothing, a vehicle a site
// says was never theirs.
//
// Two rules the implementation has to keep:
//
//   an ADD outranks the fuel rule, because that is the whole point of it, but
//   only with a reason written down when there is no diesel behind it;
//
//   a REMOVE takes one site's segment out and leaves the machine's other sites
//   billed exactly as before — a machine that worked three sites and is removed
//   from one still owes the other two.

import { describe, expect, it } from "vitest";

type Action = "ADD" | "REMOVE";
interface Override { projectId: string; action: Action; reason: string | null }

/** Mirrors the gate in generateBillForAsset. */
function billOutcome(o: {
  fuelThisPeriod: number;
  resolvedSite: string | null;
  segments: { projectId: string; days: number }[];
  overrides: Override[];
}): { billed: boolean; site: string | null; segments: string[] } {
  const added = o.overrides.find((x) => x.action === "ADD") ?? null;
  const removed = new Set(o.overrides.filter((x) => x.action === "REMOVE").map((x) => x.projectId));

  if (o.fuelThisPeriod === 0 && !added) return { billed: false, site: null, segments: [] };

  const kept = o.segments.filter((s) => !removed.has(s.projectId));
  if (o.segments.length > 0 && kept.length === 0) return { billed: false, site: null, segments: [] };
  if (kept.length > 0) {
    return { billed: true, site: kept.slice().sort((a, b) => b.days - a.days)[0].projectId, segments: kept.map((s) => s.projectId) };
  }

  const site = added ? added.projectId : o.resolvedSite;
  if (!site) return { billed: false, site: null, segments: [] };
  if (!added && removed.has(site)) return { billed: false, site: null, segments: [] };
  return { billed: true, site, segments: [site] };
}

/** Mirrors the reason requirement in addVehicleToSiteBillingAction. */
function addAccepted(fuelHereLitres: number, reason: string): boolean {
  return fuelHereLitres > 0 || reason.trim().length >= 4;
}

const KARA = "kara", BGP = "bgp", GAMP = "gamp";

describe("adding a vehicle a site's records do not support", () => {
  it("bills a machine with no fuel anywhere once it is added", () => {
    const r = billOutcome({
      fuelThisPeriod: 0, resolvedSite: null, segments: [],
      overrides: [{ projectId: KARA, action: "ADD", reason: "stood on site all month at the client's request" }],
    });
    expect(r).toEqual({ billed: true, site: KARA, segments: [KARA] });
  });

  it("without the add, the same machine bills nobody", () => {
    expect(billOutcome({ fuelThisPeriod: 0, resolvedSite: KARA, segments: [], overrides: [] }).billed).toBe(false);
  });

  it("sends the bill to the site that asked for it, not the one the records name", () => {
    const r = billOutcome({
      fuelThisPeriod: 0, resolvedSite: BGP, segments: [],
      overrides: [{ projectId: KARA, action: "ADD", reason: "hired to Karaitivu for the month" }],
    });
    expect(r.site).toBe(KARA);
  });
});

describe("what an add has to justify", () => {
  it("needs no reason when the site's own pump fuelled it", () => {
    // 64-7131 drew 360 L from the Karaitivu pump in July. The diesel is the case.
    expect(addAccepted(360, "")).toBe(true);
  });

  it("needs a reason when it drew nothing here", () => {
    expect(addAccepted(0, "")).toBe(false);
    expect(addAccepted(0, "   ")).toBe(false);
    expect(addAccepted(0, "x")).toBe(false);
  });

  it("accepts a reason worth reading", () => {
    expect(addAccepted(0, "idle on standby at the client's request")).toBe(true);
  });
});

describe("removing a vehicle from one site", () => {
  it("takes the machine off a bill it was the only site of", () => {
    const r = billOutcome({
      fuelThisPeriod: 400, resolvedSite: KARA, segments: [],
      overrides: [{ projectId: KARA, action: "REMOVE", reason: "site says it never arrived" }],
    });
    expect(r.billed).toBe(false);
  });

  it("leaves the other sites of a shared bill alone", () => {
    // BD-04 worked Badalgama and Karaitivu in July. Removed from Karaitivu, the
    // Badalgama days are billed exactly as before.
    const r = billOutcome({
      fuelThisPeriod: 250, resolvedSite: null,
      segments: [{ projectId: BGP, days: 27 }, { projectId: KARA, days: 1 }],
      overrides: [{ projectId: KARA, action: "REMOVE", reason: "went straight to Badalgama" }],
    });
    expect(r.segments).toEqual([BGP]);
    expect(r.site).toBe(BGP);
  });

  it("re-addresses the invoice when the removed site was the dominant one", () => {
    const r = billOutcome({
      fuelThisPeriod: 250, resolvedSite: null,
      segments: [{ projectId: KARA, days: 27 }, { projectId: BGP, days: 3 }],
      overrides: [{ projectId: KARA, action: "REMOVE", reason: "not ours" }],
    });
    expect(r.site).toBe(BGP);
  });

  it("removes the bill when every site it worked has disowned it", () => {
    const r = billOutcome({
      fuelThisPeriod: 100, resolvedSite: null,
      segments: [{ projectId: KARA, days: 10 }, { projectId: GAMP, days: 5 }],
      overrides: [
        { projectId: KARA, action: "REMOVE", reason: "not ours" },
        { projectId: GAMP, action: "REMOVE", reason: "not ours either" },
      ],
    });
    expect(r.billed).toBe(false);
  });
});

describe("an add outranks a remove", () => {
  it("bills the site that asked for it even where another has disowned it", () => {
    // Contradictory instructions are possible; the explicit add is the later,
    // more specific one and wins rather than the pair cancelling out.
    const r = billOutcome({
      fuelThisPeriod: 0, resolvedSite: BGP, segments: [],
      overrides: [
        { projectId: BGP, action: "REMOVE", reason: "not ours" },
        { projectId: KARA, action: "ADD", reason: "it was here all month" },
      ],
    });
    expect(r).toEqual({ billed: true, site: KARA, segments: [KARA] });
  });
});

describe("undoing", () => {
  it("puts the machine back where the records had it", () => {
    const before = billOutcome({ fuelThisPeriod: 400, resolvedSite: KARA, segments: [], overrides: [] });
    const removed = billOutcome({
      fuelThisPeriod: 400, resolvedSite: KARA, segments: [],
      overrides: [{ projectId: KARA, action: "REMOVE", reason: "mistake" }],
    });
    const undone = billOutcome({ fuelThisPeriod: 400, resolvedSite: KARA, segments: [], overrides: [] });
    expect(removed.billed).toBe(false);
    expect(undone).toEqual(before);
  });
});
