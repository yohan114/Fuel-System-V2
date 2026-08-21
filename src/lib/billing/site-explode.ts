// Distributing a multi-site bill's value to the sites that earned it.
//
// A vehicle that moved between sites during the month is still ONE bill — one
// row, one invoice number, one grand total — but its line items already carry
// the site each charge belongs to. HEX-37 in July 2026 is the shape of it:
// 13 days at Awissawella, 12 at Galagedara, 6 at Badalgama Plant. The bill's
// header site is whichever site it ended at, and every report that grouped by
// that header handed the whole Rs 1,203,034.82 to Awissawella and nothing to
// the other two.
//
// This module explodes such a bill into one portion per site, so the site-wise
// reports charge each client only for the days it actually had the machine.
// The arithmetic is exact to the cent: portions always sum back to the original.

/**
 * Split a cent amount across weighted shares without losing or inventing a cent.
 *
 * Rounding each share on its own leaves a residual — three equal shares of
 * Rs 100.00 round to 33.33 and a cent goes missing. The residual is given to the
 * largest share, where it is proportionally smallest. `sum(result) === total`
 * always holds, including for negative totals and all-zero weights.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const parts = weights.map((w) =>
    Math.round(totalWeight !== 0 ? (totalCents * w) / totalWeight : totalCents / weights.length)
  );
  let biggest = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] > weights[biggest]) biggest = i;
  parts[biggest] += totalCents - parts.reduce((s, p) => s + p, 0);
  return parts;
}

export interface ExplodedBill {
  /** Synthetic id, `<billId>__<projectId>`, unique per portion. */
  id: string;
  /** The real Bill this portion came from — several portions share one. */
  sourceBillId: string;
  /** This site's fraction of the bill subtotal, for apportioning anything else. */
  siteShare: number;
  /** True when the bill was split; false when it passed through whole. */
  isSitePortion: boolean;
  [key: string]: any;
}

/**
 * Explode bills into per-site portions.
 *
 * Every bill gains `sourceBillId` and `siteShare` so callers can apportion
 * credit notes and payments the same way. A bill whose line items name a single
 * site passes through unchanged apart from those fields.
 *
 * `codeById` maps projectId → project code so each portion carries the right
 * site code for filtering; without it a portion keeps the header bill's code.
 */
export function explodeBillsBySite(bills: any[], codeById?: Map<string, string>): ExplodedBill[] {
  const out: ExplodedBill[] = [];

  const whole = (b: any): ExplodedBill => ({
    ...b,
    id: b.id,
    sourceBillId: b.id,
    siteShare: 1,
    isSitePortion: false,
    assignedDays: (b.lineItems || [])
      .filter((l: any) => l.kind === "RENTAL")
      .reduce((n: number, l: any) => n + parseSegmentDays(l.description || ""), 0),
  });

  for (const b of bills) {
    const items = (b.lineItems || []).filter((l: any) => l.kind === "RENTAL" || l.kind === "FUEL");
    if (items.length === 0) {
      out.push(whole(b));
      continue;
    }

    const bySite = new Map<
      string,
      { projectId: string | null; projectName: string | null; rental: number; fuel: number; litres: number; billed: number; days: number }
    >();
    for (const l of items) {
      const key = l.projectId || l.projectName || "__none__";
      if (!bySite.has(key)) {
        bySite.set(key, {
          projectId: l.projectId ?? null,
          projectName: l.projectName ?? null,
          rental: 0, fuel: 0, litres: 0, billed: 0, days: 0,
        });
      }
      const g = bySite.get(key)!;
      if (l.kind === "RENTAL") {
        g.rental += l.amountCents;
        g.billed += l.quantity || 0;
        g.days += parseSegmentDays(l.description || "");
      } else {
        g.fuel += l.amountCents;
        g.litres += l.quantity || 0;
      }
    }

    const portions = [...bySite.values()];
    if (portions.length === 1) {
      out.push(whole(b));
      continue;
    }

    // Weight every apportioned figure by the site's own subtotal, so tax follows
    // the value it was charged on. Weights come from the line items rather than
    // Bill.subtotalCents so the shares stay self-consistent even if the two ever
    // drift apart.
    const weights = portions.map((p) => p.rental + p.fuel);
    const weightTotal = weights.reduce((s, w) => s + w, 0);
    const sscl = apportionCents(b.ssclCents || 0, weights);
    const vat = apportionCents(b.vatCents || 0, weights);
    const grand = apportionCents(b.grandTotalCents || 0, weights);
    const subtotal = apportionCents(b.subtotalCents ?? weightTotal, weights);

    portions.forEach((p, i) => {
      out.push({
        ...b,
        id: `${b.id}__${p.projectId || p.projectName}`,
        sourceBillId: b.id,
        siteShare: weightTotal !== 0 ? weights[i] / weightTotal : 1 / portions.length,
        isSitePortion: true,
        projectId: p.projectId,
        projectName: p.projectName,
        projectCode: (p.projectId && codeById?.get(p.projectId)) || b.projectCode,
        rentalAmountCents: p.rental,
        fuelCostCents: p.fuel,
        fuelLitres: p.litres,
        billableUnits: p.billed,
        assignedDays: p.days,
        // A split vehicle has one meter reading for the month; there is no
        // honest way to say how much of it moved at each site, so the per-site
        // rows show none rather than a made-up number.
        actualMeterUnits: null,
        actualUnits: null,
        subtotalCents: subtotal[i],
        ssclCents: sscl[i],
        vatCents: vat[i],
        grandTotalCents: grand[i],
        lineItems: undefined,
      });
    });
  }

  return out;
}

const DAYS_RE = /·\s*(\d+(?:\.\d+)?)\s*days?\b/i;

/** Days on site, read back out of a segment's description. */
function parseSegmentDays(description: string): number {
  const m = description.match(DAYS_RE);
  return m ? parseFloat(m[1]) : 0;
}
