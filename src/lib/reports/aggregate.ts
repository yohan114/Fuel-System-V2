import { prisma } from "../db";
import { recommendedUnits, varianceFlag } from "./recommended";

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
  const fuelKindTotals: Record<string, { litres: number; costCents: number }> = {
    AUTO_DIESEL: { litres: 0, costCents: 0 },
    SUPER_DIESEL: { litres: 0, costCents: 0 },
  };

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

    // Daily trend totals
    const dayKey = issue.issueDate.toISOString().split("T")[0];
    if (!trendTotals[dayKey]) {
      trendTotals[dayKey] = { date: dayKey, litres: 0, costCents: 0 };
    }
    trendTotals[dayKey].litres += issue.litres;
    trendTotals[dayKey].costCents += issue.totalCost;
  }

  // Calculate efficiency & running for assets in breakdown
  const assetsList = [];
  for (const [aId, total] of Object.entries(assetTotals)) {
    // Find the boundary readings to compute the mileage/hours run in the window
    // 1. Earliest reading in window (or latest before the start date as anchor)
    const firstReading = await prisma.meterReading.findFirst({
      where: {
        assetId: aId,
        readingDate: { lte: from },
      },
      orderBy: [
        { value: "desc" },
        { readingDate: "desc" }
      ],
    }) || await prisma.meterReading.findFirst({
      where: {
        assetId: aId,
        readingDate: { gte: from, lte: to },
      },
      orderBy: [
        { value: "asc" },
        { readingDate: "asc" }
      ],
    });

    // 2. Latest reading in window (on or before end date)
    const lastReading = await prisma.meterReading.findFirst({
      where: {
        assetId: aId,
        readingDate: { lte: to },
      },
      orderBy: [
        { value: "desc" },
        { readingDate: "desc" }
      ],
    });

    let runningDelta = 0;
    let efficiency = null;

    if (firstReading && lastReading && lastReading.value > firstReading.value) {
      runningDelta = lastReading.value - firstReading.value;
      if (total.litres > 0) {
        if (total.meterType === "KM") {
          efficiency = runningDelta / total.litres; // km/L
        } else {
          efficiency = total.litres / runningDelta; // litres/hour
        }
      }
    }

    const recommended = recommendedUnits(total.litres, total.fuelConsTyp);
    const v = varianceFlag(runningDelta, recommended);
    assetsList.push({
      ...total,
      runningDelta,
      efficiency,
      recommended,
      variancePct: v.variancePct,
      flag: v.flag,
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
