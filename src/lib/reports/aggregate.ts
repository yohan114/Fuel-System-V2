import { prisma } from "../db";
import { FUEL_KIND_CODES } from "../fuel-kinds";
import { recommendedUnits, varianceFlag } from "./recommended";
import { colomboDayKey } from "../colombo-date";

export interface ReportFilter {
  from: Date;
  to: Date;
  fuelKind?: string;
  categoryId?: string;
  assetId?: string;
  projectId?: string;
}

export async function aggregateFuelData(filter: ReportFilter) {
  const { from, to, fuelKind, categoryId, assetId, projectId } = filter;

  // Build where clause for FuelIssue (voided issues are excluded from reports)
  const issueWhere: any = {
    voided: false,
    issueDate: {
      gte: from,
      lte: to,
    },
  };

  if (fuelKind) issueWhere.fuelKind = fuelKind;
  if (assetId) issueWhere.assetId = assetId;
  const assetFilter: any = {};
  if (categoryId) assetFilter.categoryId = categoryId;
  if (projectId) assetFilter.projectId = projectId;
  if (Object.keys(assetFilter).length > 0) issueWhere.asset = assetFilter;

  // Fetch all matching issues (never load the photo BLOB into aggregates).
  const issues = await prisma.fuelIssue.findMany({
    where: issueWhere,
    omit: { photoData: true },
    include: {
      asset: {
        include: {
          category: true,
          project: true,
          rentalRate: true,
        },
      },
    },
    orderBy: {
      issueDate: "asc",
    },
  });

  // Calculate totals
  let totalLitres = 0;
  let totalCostCents = 0;
  const issueCount = issues.length;

  const categoryTotals: Record<string, { name: string; code: string; litres: number; costCents: number }> = {};
  const assetTotals: Record<string, { code: string; brand: string | null; typeLabel: string | null; litres: number; costCents: number; meterType: string; assetId: string; fuelConsTyp: number | null; categoryName: string; projectName: string | null; projectCode: string | null; issueCount: number }> = {};
  const trendTotals: Record<string, { date: string; litres: number; costCents: number }> = {};
  const fuelKindTotals: Record<string, { litres: number; costCents: number }> = Object.fromEntries(
    FUEL_KIND_CODES.map((code) => [code, { litres: 0, costCents: 0 }]),
  );

  interface SiteTotalPoint {
    id: string;
    name: string;
    code: string;
    autoLitres: number;
    superLitres: number;
    totalLitres: number;
    costCents: number;
    issueCount: number;
    vehicleCount: number;
  }
  const siteTotals: Record<string, SiteTotalPoint> = {};
  // Distinct assets fueled per site, for the "total site vehicles" count.
  const siteAssetSets: Record<string, Set<string>> = {};

  for (const issue of issues) {
    totalLitres += issue.litres;
    totalCostCents += issue.totalCost;

    // Fuel kind totals
    if (fuelKindTotals[issue.fuelKind]) {
      fuelKindTotals[issue.fuelKind].litres += issue.litres;
      fuelKindTotals[issue.fuelKind].costCents += issue.totalCost;
    } else {
      fuelKindTotals[issue.fuelKind] = { litres: issue.litres, costCents: issue.totalCost };
    }

    // Category totals
    const cat = issue.asset.category;
    if (!categoryTotals[cat.id]) {
      categoryTotals[cat.id] = { name: cat.name, code: cat.code, litres: 0, costCents: 0 };
    }
    categoryTotals[cat.id].litres += issue.litres;
    categoryTotals[cat.id].costCents += issue.totalCost;

    // Project site totals
    const proj = issue.asset.project;
    const siteId = proj ? proj.id : "unassigned";
    const siteName = proj ? proj.name : "Unassigned / Global Pool";
    const siteCode = proj ? proj.code : "GLOBAL";

    if (!siteTotals[siteId]) {
      siteTotals[siteId] = {
        id: siteId,
        name: siteName,
        code: siteCode,
        autoLitres: 0,
        superLitres: 0,
        totalLitres: 0,
        costCents: 0,
        issueCount: 0,
        vehicleCount: 0,
      };
    }
    (siteAssetSets[siteId] ||= new Set()).add(issue.asset.id);
    siteTotals[siteId].issueCount++;
    siteTotals[siteId].costCents += issue.totalCost;
    siteTotals[siteId].totalLitres += issue.litres;
    if (issue.fuelKind === "AUTO_DIESEL") {
      siteTotals[siteId].autoLitres += issue.litres;
    } else {
      siteTotals[siteId].superLitres += issue.litres;
    }

    // Asset totals
    const aId = issue.asset.id;
    if (!assetTotals[aId]) {
      assetTotals[aId] = {
        assetId: aId,
        code: issue.asset.code,
        brand: issue.asset.brand,
        typeLabel: issue.asset.typeLabel,
        litres: 0,
        costCents: 0,
        meterType: issue.asset.meterType,
        fuelConsTyp: issue.asset.rentalRate?.fuelConsTyp ?? null,
        categoryName: issue.asset.category.name,
        projectName: issue.asset.project?.name ?? null,
        projectCode: issue.asset.project?.code ?? null,
        issueCount: 0,
      };
    }
    assetTotals[aId].litres += issue.litres;
    assetTotals[aId].costCents += issue.totalCost;
    assetTotals[aId].issueCount += 1;

    // Daily trend totals, bucketed by the attendant's Colombo day. An
    // imported row sits at Colombo midnight = 18:30Z the day before, so a UTC
    // key files the whole of one day's fuel under the previous date.
    const dayKey = colomboDayKey(issue.issueDate);
    if (!trendTotals[dayKey]) {
      trendTotals[dayKey] = { date: dayKey, litres: 0, costCents: 0 };
    }
    trendTotals[dayKey].litres += issue.litres;
    trendTotals[dayKey].costCents += issue.totalCost;
  }

  // Boundary meter readings for every asset in the breakdown, in TWO bulk
  // queries instead of one findFirst per asset per boundary. The old loop
  // issued 2 × N SQLite round-trips (~400 on a 200-asset fleet) and was the
  // dominant cost of this page; the groupBys below are two index-covered
  // scans regardless of fleet size.
  //
  // The "first" reading is the HIGHEST value recorded on or before `from` —
  // mirrors the old `orderBy [{ value: "desc" }, { readingDate: "desc" }]`
  // against `readingDate: { lte: from }`. When no such reading exists we fall
  // back to the LOWEST reading inside the window, same as the original.
  // The "last" reading is the HIGHEST value on or before `to`.
  const assetIdList = Object.keys(assetTotals);
  const [firstBefore, firstInWindow, lastUpToEnd, outages, googleReadings] = assetIdList.length === 0
    ? [[], [], [], [], []]
    : await Promise.all([
        prisma.meterReading.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIdList }, readingDate: { lte: from } },
          _max: { value: true },
        }),
        prisma.meterReading.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIdList }, readingDate: { gte: from, lte: to } },
          _min: { value: true },
        }),
        prisma.meterReading.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIdList }, readingDate: { lte: to } },
          _max: { value: true },
        }),
        prisma.meterOutage.findMany({
          where: {
            assetId: { in: assetIdList },
            startDate: { lte: to },
            OR: [{ endDate: null }, { endDate: { gte: from } }],
          },
        }),
        prisma.meterReading.findMany({
          where: {
            assetId: { in: assetIdList },
            source: "GOOGLE_ESTIMATE",
            readingDate: { gte: from, lte: to },
          },
          select: { assetId: true, readingDate: true },
        }),
      ]);

  const firstBeforeMap = new Map(firstBefore.map((r) => [r.assetId, r._max.value]));
  const firstInWindowMap = new Map(firstInWindow.map((r) => [r.assetId, r._min.value]));
  const lastUpToEndMap = new Map(lastUpToEnd.map((r) => [r.assetId, r._max.value]));

  const outagesByAsset = new Map<string, typeof outages>();
  for (const o of outages) {
    if (!outagesByAsset.has(o.assetId)) outagesByAsset.set(o.assetId, []);
    outagesByAsset.get(o.assetId)!.push(o);
  }

  const googleDatesByAsset = new Map<string, Set<string>>();
  for (const r of googleReadings) {
    if (!googleDatesByAsset.has(r.assetId)) googleDatesByAsset.set(r.assetId, new Set());
    googleDatesByAsset.get(r.assetId)!.add(colomboDayKey(r.readingDate));
  }

  const assetsList = [];
  for (const [aId, total] of Object.entries(assetTotals)) {
    const firstValue = firstBeforeMap.get(aId) ?? firstInWindowMap.get(aId) ?? null;
    const lastValue = lastUpToEndMap.get(aId) ?? null;

    let runningDelta = 0;
    let efficiency: number | null = null;

    if (firstValue != null && lastValue != null && lastValue > firstValue) {
      runningDelta = lastValue - firstValue;
      if (total.litres > 0) {
        if (total.meterType === "KM") {
          efficiency = runningDelta / total.litres; // km/L
        } else {
          efficiency = total.litres / runningDelta; // litres/hour
        }
      }
    }

    const assetOutages = outagesByAsset.get(aId) || [];
    let outageDays = 0;
    for (const o of assetOutages) {
      const oStart = o.startDate < from ? from : o.startDate;
      const oEnd = !o.endDate || o.endDate > to ? to : o.endDate;
      if (oEnd >= oStart) {
        const days = Math.ceil((oEnd.getTime() - oStart.getTime()) / (24 * 60 * 60 * 1000));
        outageDays += Math.max(1, days);
      }
    }
    const gCount = googleDatesByAsset.get(aId)?.size ?? 0;
    const estimatedDays = Math.max(outageDays, gCount);

    const recommended = recommendedUnits(total.litres, total.fuelConsTyp);
    const v = varianceFlag(runningDelta, recommended);
    assetsList.push({
      ...total,
      runningDelta,
      efficiency,
      recommended,
      variancePct: v.variancePct,
      flag: v.flag,
      estimatedDays,
    });
  }

  // Resolve the distinct-vehicle count per site for the breakdown.
  for (const [sid, s] of Object.entries(siteTotals)) {
    s.vehicleCount = siteAssetSets[sid]?.size ?? 0;
  }

  // Sort assets by cost descending
  assetsList.sort((a, b) => b.costCents - a.costCents);

  return {
    totalLitres,
    totalCostCents,
    issueCount,
    categoryBreakdown: Object.values(categoryTotals).sort((a, b) => b.costCents - a.costCents),
    assetBreakdown: assetsList,
    fuelSplit: fuelKindTotals,
    trend: Object.values(trendTotals).sort((a, b) => a.date.localeCompare(b.date)),
    siteBreakdown: Object.values(siteTotals).sort((a, b) => b.totalLitres - a.totalLitres),
  };
}
