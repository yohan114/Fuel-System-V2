import { prisma } from "../db";
import { computeWindowDelta } from "../billing/usage";

// Fleet utilization & downtime, derived from the daily condition logs
// (WORKING / BREAKDOWN) and meter growth. Bounded to the "available fleet" for
// the window — assets that have at least one condition log — so the per-asset
// meter query stays proportional to active vehicles.

export interface UtilRow {
  assetId: string;
  code: string;
  categoryName: string;
  projectName: string | null;
  meterType: string;
  workingDays: number;
  breakdownDays: number;
  loggedDays: number;
  meterDelta: number;
  utilizationPct: number; // workingDays / calendar days in window
  downtimePct: number; // breakdownDays / loggedDays
}

function daysInWindow(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

export async function getFleetUtilization(opts: {
  from: Date;
  to: Date;
  projectId?: string;
}): Promise<UtilRow[]> {
  const { from, to, projectId } = opts;

  const conditions = await prisma.dailyCondition.findMany({
    where: { logDate: { gte: from, lte: to }, ...(projectId ? { asset: { projectId } } : {}) },
    select: {
      assetId: true,
      status: true,
      asset: {
        select: { code: true, meterType: true, category: { select: { name: true } }, project: { select: { name: true } } },
      },
    },
  });

  interface Acc {
    code: string;
    categoryName: string;
    projectName: string | null;
    meterType: string;
    working: number;
    breakdown: number;
  }
  const byAsset = new Map<string, Acc>();
  for (const c of conditions) {
    let a = byAsset.get(c.assetId);
    if (!a) {
      a = {
        code: c.asset.code,
        categoryName: c.asset.category.name,
        projectName: c.asset.project?.name ?? null,
        meterType: c.asset.meterType,
        working: 0,
        breakdown: 0,
      };
      byAsset.set(c.assetId, a);
    }
    if (c.status === "WORKING") a.working++;
    else if (c.status === "BREAKDOWN") a.breakdown++;
  }

  const calDays = daysInWindow(from, to);
  const rows: UtilRow[] = [];
  for (const [assetId, a] of byAsset) {
    const rd = await computeWindowDelta(assetId, a.meterType as "KM" | "HOURS", from, to);
    const loggedDays = a.working + a.breakdown;
    rows.push({
      assetId,
      code: a.code,
      categoryName: a.categoryName,
      projectName: a.projectName,
      meterType: a.meterType,
      workingDays: a.working,
      breakdownDays: a.breakdown,
      loggedDays,
      meterDelta: rd.delta,
      utilizationPct: a.working / calDays,
      downtimePct: loggedDays > 0 ? a.breakdown / loggedDays : 0,
    });
  }

  return rows;
}
