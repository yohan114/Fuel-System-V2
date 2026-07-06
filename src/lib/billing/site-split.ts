// Per-site split of a multi-site bill, reconstructed from its stored line
// items (the single source of truth — assignments may have changed since the
// bill was generated, so we never re-derive from live postings).
//
// The engine writes one RENTAL line per assignment segment with the segment's
// day count embedded in the description ("… · 18 days"), and one FUEL line per
// site. This module groups those lines by site and re-states the calculation a
// client would want to check: days on site → prorated minimum share
// (minimum × days ÷ total days) → units actually billed → rental + fuel →
// site total.

export interface SplitLineItem {
  kind: string;
  description: string;
  quantity: number;
  amountCents: number;
  projectId: string | null;
  projectName: string | null;
}

export interface SiteSplitRow {
  projectKey: string;
  projectName: string;
  days: number;
  minShareUnits: number; // minimumUnits × days/totalDays
  billableUnits: number; // Σ RENTAL qty charged to this site
  rentalCents: number;
  fuelLitres: number;
  fuelCents: number;
  totalCents: number; // rental + fuel
  atMinimum: boolean; // billed exactly the prorated guarantee
}

export interface SiteSplit {
  rows: SiteSplitRow[];
  totalDays: number;
  minimumUnits: number;
}

const DAYS_RE = /·\s*(\d+(?:\.\d+)?)\s*days?\b/i;

export function parseSegmentDays(description: string): number {
  const m = description.match(DAYS_RE);
  return m ? parseFloat(m[1]) : 0;
}

// Returns null unless the bill's charged lines genuinely span 2+ sites.
export function computeSiteSplit(lineItems: SplitLineItem[], minimumUnits: number): SiteSplit | null {
  const charged = lineItems.filter((li) => li.kind === "RENTAL" || li.kind === "FUEL");
  const keys = new Set(charged.map((li) => li.projectId || li.projectName || ""));
  keys.delete("");
  if (keys.size < 2) return null;

  const rows = new Map<string, SiteSplitRow>();
  const ensure = (key: string, name: string): SiteSplitRow => {
    let r = rows.get(key);
    if (!r) {
      r = { projectKey: key, projectName: name, days: 0, minShareUnits: 0, billableUnits: 0, rentalCents: 0, fuelLitres: 0, fuelCents: 0, totalCents: 0, atMinimum: false };
      rows.set(key, r);
    }
    return r;
  };

  for (const li of charged) {
    const key = li.projectId || li.projectName || "—";
    const r = ensure(key, li.projectName || "Unassigned");
    if (li.kind === "RENTAL") {
      r.days += parseSegmentDays(li.description);
      r.billableUnits += li.quantity;
      r.rentalCents += li.amountCents;
    } else {
      r.fuelLitres += li.quantity;
      r.fuelCents += li.amountCents;
    }
  }

  const totalDays = [...rows.values()].reduce((s, r) => s + r.days, 0);
  for (const r of rows.values()) {
    r.minShareUnits = totalDays > 0 ? minimumUnits * (r.days / totalDays) : 0;
    r.totalCents = r.rentalCents + r.fuelCents;
    // Same display tolerance as elsewhere: equal at 2-dp precision.
    r.atMinimum = r.billableUnits > 0 && Math.abs(r.billableUnits - r.minShareUnits) < 0.005;
  }

  return {
    rows: [...rows.values()].sort((a, b) => b.days - a.days || a.projectName.localeCompare(b.projectName)),
    totalDays,
    minimumUnits,
  };
}
