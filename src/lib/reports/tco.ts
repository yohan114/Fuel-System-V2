import { prisma } from "../db";

export interface TCOFilter {
  from: Date;
  to: Date;
  projectId?: string;
}

export interface TCORow {
  assetId: string;
  code: string;
  label: string;
  categoryName: string;
  projectName: string | null;
  projectCode: string | null;
  fuelCents: number;
  fuelCount: number;
  serviceCents: number;
  serviceCount: number;
  totalCents: number;
}

/**
 * Total cost of ownership per vehicle over a window: fuel spend (non-voided
 * issues) + service spend (grand-total per record, falling back to the legacy
 * cost mirror). Returns only assets with non-zero spend, sorted by total.
 */
export async function aggregateTCO({ from, to, projectId }: TCOFilter) {
  const assetWhere = projectId ? { projectId } : undefined;

  const [fuelAgg, svcRows] = await Promise.all([
    prisma.fuelIssue.groupBy({
      by: ["assetId"],
      where: {
        voided: false,
        issueDate: { gte: from, lte: to },
        ...(assetWhere ? { asset: assetWhere } : {}),
      },
      _sum: { totalCost: true },
      _count: { _all: true },
    }),
    prisma.serviceRecord.findMany({
      where: {
        serviceDate: { gte: from, lte: to },
        ...(assetWhere ? { asset: assetWhere } : {}),
      },
      select: { assetId: true, grandTotalCents: true, costCents: true },
    }),
  ]);

  const fuel = new Map<string, { cents: number; count: number }>();
  for (const f of fuelAgg) fuel.set(f.assetId, { cents: f._sum.totalCost ?? 0, count: f._count._all });

  const svc = new Map<string, { cents: number; count: number }>();
  for (const s of svcRows) {
    const cents = s.grandTotalCents || s.costCents || 0;
    const cur = svc.get(s.assetId) ?? { cents: 0, count: 0 };
    cur.cents += cents;
    cur.count += 1;
    svc.set(s.assetId, cur);
  }

  const ids = Array.from(new Set([...fuel.keys(), ...svc.keys()]));
  const assets = ids.length
    ? await prisma.asset.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          brand: true,
          typeLabel: true,
          category: { select: { name: true } },
          project: { select: { name: true, code: true } },
        },
      })
    : [];
  const aMap = new Map(assets.map((a) => [a.id, a]));

  const rows: TCORow[] = ids
    .map((id) => {
      const a = aMap.get(id);
      const fc = fuel.get(id)?.cents ?? 0;
      const sc = svc.get(id)?.cents ?? 0;
      return {
        assetId: id,
        code: a?.code ?? "—",
        label: a?.brand || a?.typeLabel || "",
        categoryName: a?.category?.name ?? "—",
        projectName: a?.project?.name ?? null,
        projectCode: a?.project?.code ?? null,
        fuelCents: fc,
        fuelCount: fuel.get(id)?.count ?? 0,
        serviceCents: sc,
        serviceCount: svc.get(id)?.count ?? 0,
        totalCents: fc + sc,
      };
    })
    .filter((r) => r.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);

  const totalFuelCents = rows.reduce((s, r) => s + r.fuelCents, 0);
  const totalServiceCents = rows.reduce((s, r) => s + r.serviceCents, 0);

  return {
    rows,
    totalFuelCents,
    totalServiceCents,
    totalCents: totalFuelCents + totalServiceCents,
    vehicleCount: rows.length,
  };
}
