import { prisma } from "../db";
import { normalize } from "../service/xref";

export interface ServiceReportFilter {
  from: Date;
  to: Date;
  projectId?: string;
}

/**
 * Service & maintenance spend over a window: totals (parts/labour/sundry),
 * breakdowns by site / category / service type, per-vehicle spend, and the
 * filters consumed. The service-side counterpart to aggregateFuelData.
 */
export async function aggregateServiceData({ from, to, projectId }: ServiceReportFilter) {
  const assetWhere = projectId ? { projectId } : undefined;
  const recordWhere: any = { serviceDate: { gte: from, lte: to } };
  if (assetWhere) recordWhere.asset = assetWhere;

  const records = await prisma.serviceRecord.findMany({
    where: recordWhere,
    select: {
      assetId: true,
      serviceDate: true,
      grandTotalCents: true,
      costCents: true,
      serviceType: true,
      partsSubtotalCents: true,
      labourChargeCents: true,
      sundryAmountCents: true,
      asset: {
        select: {
          code: true,
          brand: true,
          typeLabel: true,
          category: { select: { name: true } },
          project: { select: { name: true, code: true } },
        },
      },
    },
  });

  let totalCents = 0;
  let partsCents = 0;
  let labourCents = 0;
  let sundryCents = 0;
  const vehicles = new Set<string>();
  const byMonthMap = new Map<string, { cents: number; count: number }>();
  const bySite = new Map<string, { name: string; code: string; cents: number; count: number }>();
  const byCategory = new Map<string, { name: string; cents: number; count: number }>();
  const byType = new Map<string, { type: string; cents: number; count: number }>();
  const byVehicle = new Map<string, { code: string; label: string; category: string; site: string | null; cents: number; count: number }>();

  for (const r of records) {
    const cents = r.grandTotalCents || r.costCents || 0;
    totalCents += cents;
    partsCents += r.partsSubtotalCents || 0;
    labourCents += r.labourChargeCents || 0;
    sundryCents += r.sundryAmountCents || 0;
    vehicles.add(r.assetId);

    const mk = `${r.serviceDate.getUTCFullYear()}-${String(r.serviceDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const mm = byMonthMap.get(mk) ?? { cents: 0, count: 0 };
    mm.cents += cents; mm.count += 1; byMonthMap.set(mk, mm);

    const siteCode = r.asset.project?.code || "GLOBAL";
    const siteName = r.asset.project?.name || "Unassigned / Global Pool";
    const s = bySite.get(siteCode) ?? { name: siteName, code: siteCode, cents: 0, count: 0 };
    s.cents += cents; s.count++; bySite.set(siteCode, s);

    const catName = r.asset.category?.name || "—";
    const c = byCategory.get(catName) ?? { name: catName, cents: 0, count: 0 };
    c.cents += cents; c.count++; byCategory.set(catName, c);

    const tp = r.serviceType || "Unspecified";
    const t = byType.get(tp) ?? { type: tp, cents: 0, count: 0 };
    t.cents += cents; t.count++; byType.set(tp, t);

    const v = byVehicle.get(r.assetId) ?? { code: r.asset.code, label: r.asset.brand || r.asset.typeLabel || "", category: catName, site: r.asset.project?.code || null, cents: 0, count: 0 };
    v.cents += cents; v.count++; byVehicle.set(r.assetId, v);
  }

  const filterLines = await prisma.serviceFilter.findMany({
    where: { serviceRecord: recordWhere },
    select: { filterNo: true, filterCategory: true, quantity: true, priceCents: true },
  });
  const filterMap = new Map<string, { filterNo: string | null; category: string; qty: number; cents: number }>();
  for (const l of filterLines) {
    const key = normalize(l.filterNo) || `CAT::${(l.filterCategory || "UNKNOWN").toUpperCase()}`;
    const e = filterMap.get(key) ?? { filterNo: l.filterNo || null, category: l.filterCategory || "—", qty: 0, cents: 0 };
    e.qty += l.quantity || 0;
    e.cents += l.priceCents || 0;
    if (!e.filterNo && l.filterNo) e.filterNo = l.filterNo;
    filterMap.set(key, e);
  }

  // Contiguous monthly buckets across the window (zero-filled) for trend charts.
  const byMonth: { month: string; label: string; cents: number; count: number }[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cur <= end) {
    const key = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`;
    const e = byMonthMap.get(key) ?? { cents: 0, count: 0 };
    byMonth.push({ month: key, label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }), cents: e.cents, count: e.count });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  return {
    totalCents,
    partsCents,
    labourCents,
    sundryCents,
    recordCount: records.length,
    vehicleCount: vehicles.size,
    byMonth,
    bySite: Array.from(bySite.values()).sort((a, b) => b.cents - a.cents),
    byCategory: Array.from(byCategory.values()).sort((a, b) => b.cents - a.cents),
    byType: Array.from(byType.values()).sort((a, b) => b.cents - a.cents),
    topVehicles: Array.from(byVehicle.values()).sort((a, b) => b.cents - a.cents),
    filtersUsed: Array.from(filterMap.values()).sort((a, b) => b.cents - a.cents),
  };
}
