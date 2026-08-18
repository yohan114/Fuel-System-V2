// Service costing — turns the priced oil / filter / manpower lines of a service
// sheet into a parts / labour / sundry / total breakdown.
//
// From the paper "Vehicle/Machinery Service Details" sheet: "Labour Charge
// (15% — parts)" and "Sundry (5%)". Parts are the physical consumables
// (lubricants + filters); manpower is the manual cost lines in the bottom
// table. Labour and sundry are both charged on parts, and the grand total is
//
//     total = parts + manpower + labour(15%·parts) + sundry(5%·parts)
//
// The two percentages are configurable (service.labourPct / service.sundryPct).
// Everything here is pure and cent-exact so the total is unit-testable.

export const SERVICE_DEFAULTS = { labourPct: 0.15, sundryPct: 0.05 };

export type ServiceItemKind = "OIL" | "FILTER" | "MANPOWER";

export interface CostItem {
  kind: ServiceItemKind;
  amountCents: number;
}

export interface ServiceCostResult {
  lubricantCents: number;
  filterCents: number;
  partsCents: number; // lubricant + filter
  manpowerCents: number;
  labourCents: number; // round(parts · labourPct)
  sundryCents: number; // round(parts · sundryPct)
  totalCents: number; // parts + manpower + labour + sundry
}

export function computeServiceCost(
  items: CostItem[],
  opts: { labourPct?: number; sundryPct?: number } = {},
): ServiceCostResult {
  const labourPct = opts.labourPct ?? SERVICE_DEFAULTS.labourPct;
  const sundryPct = opts.sundryPct ?? SERVICE_DEFAULTS.sundryPct;

  let lubricantCents = 0;
  let filterCents = 0;
  let manpowerCents = 0;
  for (const it of items) {
    const amt = Math.round(it.amountCents || 0);
    if (it.kind === "OIL") lubricantCents += amt;
    else if (it.kind === "FILTER") filterCents += amt;
    else if (it.kind === "MANPOWER") manpowerCents += amt;
  }

  const partsCents = lubricantCents + filterCents;
  const labourCents = Math.round(partsCents * labourPct);
  const sundryCents = Math.round(partsCents * sundryPct);
  const totalCents = partsCents + manpowerCents + labourCents + sundryCents;

  return { lubricantCents, filterCents, partsCents, manpowerCents, labourCents, sundryCents, totalCents };
}

// Amount for a single oil/filter line: qty × unit price, rounded to cents.
export function lineAmountCents(qty: number, unitPriceCents: number | null | undefined): number {
  if (unitPriceCents == null) return 0;
  return Math.round((qty || 0) * unitPriceCents);
}
