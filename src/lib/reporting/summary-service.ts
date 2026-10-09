// ============================================================================
// Phase 17 — Reporting & Summary Aggregates Service
// Reference: Fuel-System-V3 Plan Section 22 (Phase 17 — Reporting and Analytics)
//
// Replaces heavy, unbounded transactional table scans with push-down
// database aggregations and multi-tier Redis caching for analytics.
// ============================================================================

import { prisma as defaultPrisma } from "@/lib/db";
import { getRedisClient, CACHE_PREFIX } from "@/lib/cache/redis";

const SUMMARY_PREFIX = `${CACHE_PREFIX}summary:`;

export interface FuelKindMetric {
  litres: number;
  costCents: number;
  issueCount: number;
}

export interface MonthlyFuelSummary {
  periodKey: string;
  projectId: string | null;
  totalLitres: number;
  totalCostCents: number;
  issueCount: number;
  byFuelKind: Record<string, FuelKindMetric>;
  fromCache?: boolean;
}

export interface DailyFuelRollup {
  date: string;
  totalLitres: number;
  totalCostCents: number;
  issueCount: number;
}

export interface AssetUtilizationItem {
  assetId: string;
  code: string;
  categoryName: string | null;
  totalLitres: number;
  totalCostCents: number;
  issueCount: number;
}

export interface BillingPeriodSummary {
  periodKey: string;
  projectId: string | null;
  totalInvoices: number;
  totalGrandCents: number;
  totalPaidCents: number;
  totalBalanceDueCents: number;
  byStatus: Record<string, { count: number; grandTotalCents: number }>;
}

/**
 * Retrieves monthly fuel consumption and financial rollups using push-down SQL
 * group-by aggregations and Redis caching.
 */
export async function getMonthlyFuelSummary(
  periodKey: string,
  options: { projectId?: string | null; forceRefresh?: boolean; prismaClient?: typeof defaultPrisma } = {}
): Promise<MonthlyFuelSummary> {
  const cache = getRedisClient();
  const prismaClient = options.prismaClient || defaultPrisma;
  const projectScope = options.projectId || "all";
  const cacheKey = `${SUMMARY_PREFIX}monthly:${periodKey}:${projectScope}`;

  // 1. Check Redis Cache
  if (!options.forceRefresh) {
    const cached = await cache.get<MonthlyFuelSummary>(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // 2. Parse Colombo Month Boundaries
  const [yearStr, monthStr] = periodKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const where: any = {
    issueDate: { gte: startDate, lte: endDate },
    voided: false,
  };

  if (options.projectId) {
    where.OR = [
      { bulkTank: { projectId: options.projectId } },
      { asset: { projectId: options.projectId } },
    ];
  }

  // 3. Database Grouped Aggregations (Push-down to DB engine)
  const grouped = await prismaClient.fuelIssue.groupBy({
    by: ["fuelKind"],
    where,
    _sum: {
      litres: true,
      totalCost: true,
    },
    _count: {
      id: true,
    },
  });

  let totalLitres = 0;
  let totalCostCents = 0;
  let issueCount = 0;
  const byFuelKind: Record<string, FuelKindMetric> = {};

  for (const row of grouped) {
    const litres = Number(row._sum?.litres || 0);
    const costCents = Number(row._sum?.totalCost || 0);
    const count = (row._count as any)?.id || (row._count as any)?._all || 0;

    totalLitres += litres;
    totalCostCents += costCents;
    issueCount += count;

    byFuelKind[row.fuelKind] = {
      litres: Math.round(litres * 100) / 100,
      costCents,
      issueCount: count,
    };
  }

  const result: MonthlyFuelSummary = {
    periodKey,
    projectId: options.projectId || null,
    totalLitres: Math.round(totalLitres * 100) / 100,
    totalCostCents,
    issueCount,
    byFuelKind,
    fromCache: false,
  };

  // 4. Cache TTL: Closed past months cached for 24h, current month cached for 60s
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const ttlSeconds = periodKey < currentMonthKey ? 86400 : 60;
  await cache.set(cacheKey, result, ttlSeconds);

  return result;
}

/**
 * Retrieves daily rollups for time-series charts across a date window.
 */
export async function getDailyFuelSummary(
  fromDate: Date,
  toDate: Date,
  options: { projectId?: string | null; prismaClient?: typeof defaultPrisma } = {}
): Promise<DailyFuelRollup[]> {
  const prismaClient = options.prismaClient || defaultPrisma;

  const where: any = {
    issueDate: { gte: fromDate, lte: toDate },
    voided: false,
  };

  if (options.projectId) {
    where.OR = [
      { bulkTank: { projectId: options.projectId } },
      { asset: { projectId: options.projectId } },
    ];
  }

  const issues = await prismaClient.fuelIssue.findMany({
    where,
    select: {
      issueDate: true,
      litres: true,
      totalCost: true,
    },
    orderBy: { issueDate: "asc" },
  });

  const dailyMap = new Map<string, { totalLitres: number; totalCostCents: number; issueCount: number }>();

  for (const issue of issues) {
    const dayKey = issue.issueDate.toISOString().slice(0, 10);
    const current = dailyMap.get(dayKey) || { totalLitres: 0, totalCostCents: 0, issueCount: 0 };
    current.totalLitres += issue.litres;
    current.totalCostCents += issue.totalCost || 0;
    current.issueCount++;
    dailyMap.set(dayKey, current);
  }

  return Array.from(dailyMap.entries()).map(([date, stats]) => ({
    date,
    totalLitres: Math.round(stats.totalLitres * 100) / 100,
    totalCostCents: stats.totalCostCents,
    issueCount: stats.issueCount,
  }));
}

/**
 * Retrieves per-asset consumption utilization summaries for a billing month.
 */
export async function getAssetUtilizationSummary(
  periodKey: string,
  options: { projectId?: string | null; prismaClient?: typeof defaultPrisma } = {}
): Promise<AssetUtilizationItem[]> {
  const prismaClient = options.prismaClient || defaultPrisma;
  const [yearStr, monthStr] = periodKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const where: any = {
    issueDate: { gte: startDate, lte: endDate },
    voided: false,
  };

  if (options.projectId) {
    where.asset = { projectId: options.projectId };
  }

  const grouped = await prismaClient.fuelIssue.groupBy({
    by: ["assetId"],
    where,
    _sum: {
      litres: true,
      totalCost: true,
    },
    _count: {
      id: true,
    },
  });

  const assetIds = grouped.map((g) => g.assetId);
  const assets = await prismaClient.asset.findMany({
    where: { id: { in: assetIds } },
    select: {
      id: true,
      code: true,
      category: { select: { name: true } },
    },
  });

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  return grouped.map((g) => {
    const asset = assetMap.get(g.assetId);
    return {
      assetId: g.assetId,
      code: asset?.code || g.assetId,
      categoryName: asset?.category?.name || null,
      totalLitres: Math.round((g._sum?.litres || 0) * 100) / 100,
      totalCostCents: g._sum?.totalCost || 0,
      issueCount: (g._count as any)?.id || (g._count as any)?._all || 0,
    };
  });
}

/**
 * Retrieves billing period totals and status breakdown.
 */
export async function getBillingSummary(
  periodKey: string,
  options: { projectId?: string | null; prismaClient?: typeof defaultPrisma } = {}
): Promise<BillingPeriodSummary> {
  const prismaClient = options.prismaClient || defaultPrisma;
  const where: any = { periodKey };

  if (options.projectId) {
    where.projectId = options.projectId;
  }

  const grouped = await prismaClient.bill.groupBy({
    by: ["status"],
    where,
    _sum: {
      grandTotalCents: true,
      paidAmountCents: true,
    },
    _count: {
      _all: true,
    },
  });

  let totalInvoices = 0;
  let totalGrandCents = 0;
  let totalPaidCents = 0;
  let totalBalanceDueCents = 0;
  const byStatus: Record<string, { count: number; grandTotalCents: number }> = {};

  for (const row of grouped) {
    const count = row._count?._all || 0;
    const grand = row._sum?.grandTotalCents || 0;
    const paid = row._sum?.paidAmountCents || 0;
    const due = Math.max(0, grand - paid);

    totalInvoices += count;
    totalGrandCents += grand;
    totalPaidCents += paid;
    totalBalanceDueCents += due;

    byStatus[row.status] = {
      count,
      grandTotalCents: grand,
    };
  }

  return {
    periodKey,
    projectId: options.projectId || null,
    totalInvoices,
    totalGrandCents,
    totalPaidCents,
    totalBalanceDueCents,
    byStatus,
  };
}

/**
 * Invalidates summary cache entries for a given period or scope
 */
export async function invalidateSummaryCache(periodKey: string, projectId?: string): Promise<number> {
  const cache = getRedisClient();
  if (projectId) {
    return cache.del(`${SUMMARY_PREFIX}monthly:${periodKey}:${projectId}`);
  }
  return cache.flushByPattern(`${SUMMARY_PREFIX}*:${periodKey}:*`);
}
