// Per-site fuel attribution for multi-site bills.
//
// The segmented billing path splits a vehicle-month into non-overlapping
// segments (one per site the vehicle was posted to). Each segment needs a fuel
// figure. The naive approach — "sum the fuel issued on the calendar days that
// fall in this segment's window" — attributes fuel to whichever site the vehicle
// happened to be posted to on the issue date, which is only a proxy: fuel is
// often booked a few days after it is burnt, or issued from a shared pump.
//
// This module re-attributes fuel by its recorded SOURCE (the site register /
// pump the litres were dispensed from) instead. The one exception is the
// Badalgama plant pump ("Badalgama app.db …"), which is a SHARED bowser that
// dispenses to many sites, so its source string does NOT identify the consuming
// site — that fuel, and any fuel sourced to a site the vehicle was not billed at
// this month, is treated as residual and folded into the bill's own sites in
// proportion to the days spent at each.
//
// Crucially this NEVER changes a bill's fuel total: the caller passes the exact
// litres/cents pot the date-window path produced, and `attributeSegmentFuel`
// redistributes precisely that pot across the segments (summing to the cent),
// so only WHICH site each fuel line is attributed to changes — the subtotal,
// SSCL, VAT and grand total are untouched. Pure and unit-tested.

// Map a raw FuelIssue.source label to a working-site project code, or null when
// the source does not identify a working site (shared Badalgama pump, wastage,
// or an unrecognised label) — null fuel is folded by day-share.
export function sourceToProjectCode(source: string | null | undefined): string | null {
  if (!source) return null;
  const s = source.toLowerCase();
  // Shared plant pump — dispenses to many sites, so it is NOT a site indicator.
  if (s.includes("badalgama")) return null;
  if (s.includes("wastage")) return null;
  if (s.includes("marawila")) return "MARA";
  // CEP-03 sub-packages (order matters: ABC and F before the bare "cep-03 e").
  if (s.includes("cep-03 abc") || s.includes("cep-03abc") || s.includes("a,b & c") || s.includes("abc package") || s.includes("abc monthly")) return "CEP-03-ABC";
  if (s.includes("galagedara")) return "CEP-03F";
  if (s.includes("cep-03 e") || s.includes("cep-03e") || s.includes("e package") || s.includes("epackage") || s.includes("e live")) return "CEP-03 E";
  if (s.includes("lot 04") || s.includes("lot-04") || s.includes("lot 4")) return "LOT-04";
  if (s.includes("lot 02") || s.includes("lot-02") || s.includes("lot 2")) return "BATTI-02";
  if (s.includes("lot 03") || s.includes("lot-03") || s.includes("lot 3")) return "BATTI";
  if (s.includes("ruwanwella")) return "RWP";
  if (s.includes("inginimitiya")) return "INGI";
  if (s.includes("karaitivu") || s.includes("karativu")) return "KB";
  if (s.includes("muthur")) return "MUTHUR";
  if (s.includes("avissawella")) return "AVIS";
  if (s.includes("ambanpola")) return "AMB";
  if (s.includes("pallanoya")) return "PNB";
  return null;
}

export interface FuelIssueLite {
  litres: number;
  costCents: number;
  source: string | null;
}

export interface SegShare {
  projectCode: string;
  days: number;
}

export interface SegFuel {
  litres: number;
  costCents: number;
}

// Redistribute a FIXED pot of fuel (potLitres / potCents — the exact total the
// date-window path already produced for this bill) across `segments`, attributing
// each site the fuel sourced to it and folding shared-pump / other-site fuel into
// the bill's sites by day-share. Returns one {litres, costCents} per input
// segment, in the same order, summing EXACTLY to the pot (so the bill total is
// unchanged). Falls back to a pure day-share split when no fuel can be sourced to
// any of the bill's sites.
export function attributeSegmentFuel(
  issues: FuelIssueLite[],
  segments: SegShare[],
  potLitres: number,
  potCents: number,
): SegFuel[] {
  const n = segments.length;
  if (n === 0) return [];
  if (n === 1) return [{ litres: potLitres, costCents: potCents }];

  // Days per site, and total days across the bill's segments.
  const siteDays = new Map<string, number>();
  for (const seg of segments) siteDays.set(seg.projectCode, (siteDays.get(seg.projectCode) ?? 0) + seg.days);
  const totalDays = [...siteDays.values()].reduce((s, d) => s + d, 0);

  // Litres sourced to each of the bill's own sites; everything else is residual.
  const siteFuel = new Map<string, number>();
  let residual = 0;
  for (const iss of issues) {
    const code = sourceToProjectCode(iss.source);
    if (code && siteDays.has(code)) siteFuel.set(code, (siteFuel.get(code) ?? 0) + iss.litres);
    else residual += iss.litres;
  }
  // Fold residual into the bill's sites by day-share.
  if (totalDays > 0 && residual > 0) {
    for (const [code, days] of siteDays) siteFuel.set(code, (siteFuel.get(code) ?? 0) + residual * (days / totalDays));
  }

  // Per-site weight = its attributed litres; fall back to day-share when nothing
  // could be sourced (e.g. every issue had an unrecognised source and no residual).
  const siteWeight = new Map<string, number>();
  const totalSiteFuel = [...siteFuel.values()].reduce((s, l) => s + l, 0);
  for (const [code, days] of siteDays) {
    const w = totalSiteFuel > 0 ? (siteFuel.get(code) ?? 0) : (totalDays > 0 ? days / totalDays : 0);
    siteWeight.set(code, w);
  }
  const totalWeight = [...siteWeight.values()].reduce((s, w) => s + w, 0);

  // Per-segment proportion: the site's weight share, split across that site's
  // own segments by their day-share within the site.
  const segProp = segments.map((seg) => {
    const sw = totalWeight > 0 ? (siteWeight.get(seg.projectCode) ?? 0) / totalWeight : 1 / n;
    const sd = siteDays.get(seg.projectCode) ?? 0;
    const withinSite = sd > 0 ? seg.days / sd : 1;
    return sw * withinSite;
  });

  // Apply proportions to the pot; give the rounding/float residual to the
  // largest-share segment so the outputs sum to the pot EXACTLY.
  const out: SegFuel[] = segProp.map((p) => ({ litres: potLitres * p, costCents: Math.round(potCents * p) }));
  let maxIdx = 0;
  for (let i = 1; i < n; i++) if (segProp[i] > segProp[maxIdx]) maxIdx = i;
  const litresResidual = potLitres - out.reduce((s, o) => s + o.litres, 0);
  const centsResidual = potCents - out.reduce((s, o) => s + o.costCents, 0);
  out[maxIdx].litres += litresResidual;
  out[maxIdx].costCents += centsResidual;
  return out;
}
