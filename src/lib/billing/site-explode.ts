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
  /** True when this portion covers more than one rate, so rateCents is a weighted average. */
  rateBlended?: boolean;
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
/**
 * The rate a set of rental lines was actually charged at.
 *
 * `Bill.rateCents` holds one rate — the dominant segment's — and a month can be
 * charged at more than one: a machine on wet hire at a client site and dry hire
 * back at the yard is billed at both, and 16 bills across May to August are.
 * Printing the header rate beside a site's own money is then simply wrong. PC-02
 * spent one day of July at Wadakada on dry hire: the line reads 3.87 hr at
 * Rs 3,860 = Rs 14,941.94, and the per-site page printed "4 hr @ Rs 4,650",
 * which multiplies out to Rs 18,600 and matches nothing.
 *
 * Where the lines agree, that rate is returned exactly. Where they do not, the
 * weighted rate is returned and flagged, because a single number cannot be the
 * whole truth and should not pretend to be.
 */
function rateOfLines(lines: any[]): { rateCents: number | null; rateBlended: boolean; rateBasis: string | null } {
  const rental = lines.filter((l) => l.kind === "RENTAL" && (l.quantity || 0) > 0);
  if (rental.length === 0) return { rateCents: null, rateBlended: false, rateBasis: null };

  // The hire basis is written into each line's description — "· hourly (D) ·"
  // — so the site's own basis comes from the same place its money does. The
  // bill header carries only the dominant segment's, which had a dry day at
  // Wadakada labelled Wet.
  const bases = [...new Set(rental.map((l) => (String(l.description || "").match(/\((FW|W|D)\)/) || [])[1]).filter(Boolean))];
  const rateBasis = bases.length === 1 ? bases[0].toLowerCase() : null;

  const distinct = [...new Set(rental.map((l) => l.unitRateCents).filter((r) => r != null && r > 0))];
  if (distinct.length === 1) return { rateCents: distinct[0] as number, rateBlended: false, rateBasis };

  const units = rental.reduce((n, l) => n + (l.quantity || 0), 0);
  const amount = rental.reduce((n, l) => n + (l.amountCents || 0), 0);
  // Zero distinct rates means the caller did not load unitRateCents; the
  // effective rate still reconciles, so it is used rather than showing nothing.
  return {
    rateCents: units > 0 ? Math.round(amount / units) : null,
    rateBlended: distinct.length > 1,
    rateBasis,
  };
}

export function explodeBillsBySite(bills: any[], codeById?: Map<string, string>): ExplodedBill[] {
  const out: ExplodedBill[] = [];

  const whole = (b: any): ExplodedBill => {
    const lines = b.lineItems || [];
    const rate = rateOfLines(lines);
    return {
      ...b,
      id: b.id,
      sourceBillId: b.id,
      siteShare: 1,
      isSitePortion: false,
      assignedDays: lines
        .filter((l: any) => l.kind === "RENTAL")
        .reduce((n: number, l: any) => n + parseSegmentDays(l.description || ""), 0),
      // Even an unsplit bill can carry two rates — a machine that went to the
      // yard and back within one site's month.
      rateCents: rate.rateCents ?? b.rateCents,
      rateBlended: rate.rateBlended,
      rateBasis: rate.rateBasis ?? b.rateBasis,
    };
  };

  for (const b of bills) {
    const items = (b.lineItems || []).filter((l: any) => l.kind === "RENTAL" || l.kind === "FUEL");
    if (items.length === 0) {
      out.push(whole(b));
      continue;
    }

    const bySite = new Map<
      string,
      { projectId: string | null; projectName: string | null; rental: number; fuel: number; litres: number; billed: number; days: number; lines: any[] }
    >();
    for (const l of items) {
      const key = l.projectId || l.projectName || "__none__";
      if (!bySite.has(key)) {
        bySite.set(key, {
          projectId: l.projectId ?? null,
          projectName: l.projectName ?? null,
          rental: 0, fuel: 0, litres: 0, billed: 0, days: 0, lines: [],
        });
      }
      const g = bySite.get(key)!;
      g.lines.push(l);
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
        // The rate THIS site was charged at, not the bill's dominant one. Units
        // × rate now reconciles with the rental beside it, which is the whole
        // job of a per-site page.
        ...(() => {
          const r = rateOfLines(p.lines);
          return { rateCents: r.rateCents ?? b.rateCents, rateBlended: r.rateBlended, rateBasis: r.rateBasis ?? b.rateBasis };
        })(),
        // A split vehicle has one meter reading for the month; there is no
        // honest way to say how much of it moved at each site, so the per-site
        // rows show none rather than a made-up number.
        actualMeterUnits: null,
        actualUnits: null,
        // The fuel-implied work, though, IS known per site: the litres are. Scale
        // the whole bill's derivation by this site's share of them, which keeps
        // the consumption basis the generator already checked rather than
        // re-deriving it here from a snapshot that may not be in the billed unit.
        // No diesel here means no fuel-implied figure at all, which is an
        // absence rather than a zero — the same way the litres column shows a
        // dash. Printing 0 would claim the fuel proves the machine did nothing.
        derivedStandardUnits:
          b.derivedStandardUnits != null && (b.fuelLitres || 0) > 0 && p.litres > 0
            ? b.derivedStandardUnits * (p.litres / b.fuelLitres)
            : null,
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
