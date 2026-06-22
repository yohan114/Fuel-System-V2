import { prisma } from "../db";
import { normalize } from "./xref";

export interface DemandRow {
  key: string;
  filterNo: string | null;
  category: string;
  monthlyQty: number;
  totalQty: number;
  monthlyCostCents: number;
  avgUnitCents: number | null;
  serviceCount: number;
  vehicleCount: number;
}

/**
 * Filter demand derived from real service history over the last N months.
 * Lines are grouped by normalized part number (falling back to category when a
 * part number is missing). Monthly spend sums the actual line prices recorded
 * at service time, so it is correct whether priceCents holds a unit or a line
 * total. Covers every filter actually fitted — not just a precomputed snapshot.
 */
export async function filterDemand(months = 12): Promise<{
  rows: DemandRow[];
  totalMonthlyCents: number;
  months: number;
  since: Date;
}> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setHours(0, 0, 0, 0);

  const lines = await prisma.serviceFilter.findMany({
    where: { serviceRecord: { serviceDate: { gte: since } } },
    select: {
      filterNo: true,
      filterCategory: true,
      quantity: true,
      priceCents: true,
      serviceRecord: { select: { assetId: true } },
    },
  });

  interface Agg {
    filterNo: string | null;
    category: string;
    qty: number;
    cents: number;
    pricedQty: number;
    services: number;
    vehicles: Set<string>;
  }
  const map = new Map<string, Agg>();

  for (const l of lines) {
    const norm = normalize(l.filterNo);
    const key = norm || `CAT::${(l.filterCategory || "UNKNOWN").toUpperCase()}`;
    let e = map.get(key);
    if (!e) {
      e = { filterNo: l.filterNo || null, category: l.filterCategory || "—", qty: 0, cents: 0, pricedQty: 0, services: 0, vehicles: new Set() };
      map.set(key, e);
    }
    const q = l.quantity || 0;
    e.qty += q;
    e.cents += l.priceCents || 0;
    if (l.priceCents > 0) e.pricedQty += q;
    e.services += 1;
    if (l.serviceRecord?.assetId) e.vehicles.add(l.serviceRecord.assetId);
    if (!e.filterNo && l.filterNo) e.filterNo = l.filterNo;
  }

  const rows: DemandRow[] = Array.from(map.entries())
    .map(([key, e]) => ({
      key,
      filterNo: e.filterNo,
      category: e.category,
      monthlyQty: e.qty / months,
      totalQty: e.qty,
      monthlyCostCents: Math.round(e.cents / months),
      avgUnitCents: e.pricedQty > 0 ? Math.round(e.cents / e.pricedQty) : null,
      serviceCount: e.services,
      vehicleCount: e.vehicles.size,
    }))
    .filter((r) => r.totalQty > 0)
    .sort((a, b) => b.monthlyCostCents - a.monthlyCostCents || b.totalQty - a.totalQty);

  const totalMonthlyCents = rows.reduce((s, r) => s + r.monthlyCostCents, 0);
  return { rows, totalMonthlyCents, months, since };
}
