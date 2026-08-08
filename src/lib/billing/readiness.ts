import { prisma } from "../db";
import { resolvePeriod } from "./period";

// Pre-generation billing readiness. Before an admin generates a month, this
// surfaces the assets that would produce a wrong or unbillable invoice, so the
// inputs get fixed before money leaves. It mirrors generateBillsForMonth's
// "available fleet" rule (a vehicle is billable for the month if it has any
// condition/fuel/reading/assignment in the window) and then flags:
//   - no rate card        → cannot be billed at all
//   - no meter reading    → a metered bill leans on the minimum or fuel-derived
//   - overlapping postings → multi-site split double-counts days (inflated bill)
//   - unpriced fuel        → fuel line lands at Rs 0
// The meter-vs-fuel "clarify" flag is shown on each generated bill separately.

export interface ReadinessAsset {
  code: string;
  label: string;
  detail?: string;
}

export interface BillingReadiness {
  year: number;
  month: number;
  periodKey: string;
  availableFleet: number;
  ready: number;
  issues: {
    noRate: ReadinessAsset[];
    noReading: ReadinessAsset[];
    overlaps: ReadinessAsset[];
    unpricedFuel: ReadinessAsset[];
  };
}

function labelOf(a: { brand: string | null; model: string | null; category: { name: string } }): string {
  return [a.brand, a.model].filter(Boolean).join(" ").trim() || a.category.name;
}

export async function getBillingReadiness(year: number, month: number): Promise<BillingReadiness> {
  const period = resolvePeriod(year, month);
  const inPeriod = { gte: period.start, lte: period.end };

  // Available fleet = anything with activity or an assignment overlapping the month.
  const [condIds, fuelIds, readIds, assignIds] = await Promise.all([
    prisma.dailyCondition.findMany({ where: { logDate: inPeriod }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.fuelIssue.findMany({ where: { issueDate: inPeriod }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.meterReading.findMany({ where: { readingDate: inPeriod }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.assetAssignment.findMany({
      where: { startDate: { lte: period.end }, OR: [{ endDate: null }, { endDate: { gte: period.start } }] },
      select: { assetId: true },
      distinct: ["assetId"],
    }),
  ]);
  const availableIds = [
    ...new Set([
      ...condIds.map((r) => r.assetId),
      ...fuelIds.map((r) => r.assetId),
      ...readIds.map((r) => r.assetId),
      ...assignIds.map((r) => r.assetId),
    ]),
  ];

  const assets = await prisma.asset.findMany({
    where: { id: { in: availableIds }, status: { not: "DISPOSED" } },
    select: {
      id: true, code: true, brand: true, model: true, meterType: true,
      category: { select: { name: true } },
      rentalRate: { select: { id: true } },
    },
    orderBy: { code: "asc" },
  });

  const readingSet = new Set(readIds.map((r) => r.assetId));

  // Unpriced fuel: a live issue this month with no usable price snapshot.
  const unpricedRows = await prisma.fuelIssue.findMany({
    where: { issueDate: inPeriod, voided: false, litres: { gt: 0 }, OR: [{ pricePerLitre: { lte: 0 } }, { totalCost: { lte: 0 } }] },
    select: { assetId: true },
    distinct: ["assetId"],
  });
  const unpricedSet = new Set(unpricedRows.map((r) => r.assetId));

  // Overlapping assignments within the month, per available asset.
  const assignments = await prisma.assetAssignment.findMany({
    where: {
      assetId: { in: availableIds },
      startDate: { lte: period.end },
      OR: [{ endDate: null }, { endDate: { gte: period.start } }],
    },
    orderBy: [{ assetId: "asc" }, { startDate: "asc" }],
    select: { assetId: true, startDate: true, endDate: true },
  });
  const overlapSet = new Set<string>();
  const byAsset = new Map<string, { startDate: Date; endDate: Date | null }[]>();
  for (const a of assignments) {
    (byAsset.get(a.assetId) ?? byAsset.set(a.assetId, []).get(a.assetId)!).push(a);
  }
  for (const [assetId, list] of byAsset) {
    for (let i = 1; i < list.length; i++) {
      const prevEnd = list[i - 1].endDate ? list[i - 1].endDate!.getTime() : Infinity;
      if (list[i].startDate.getTime() <= prevEnd) {
        overlapSet.add(assetId);
        break;
      }
    }
  }

  const issues = {
    noRate: [] as ReadinessAsset[],
    noReading: [] as ReadinessAsset[],
    overlaps: [] as ReadinessAsset[],
    unpricedFuel: [] as ReadinessAsset[],
  };
  let ready = 0;

  for (const a of assets) {
    const label = labelOf(a);
    let problem = false;
    if (!a.rentalRate) {
      issues.noRate.push({ code: a.code, label });
      problem = true;
    } else if (!readingSet.has(a.id)) {
      // A metered vehicle with no reading this month will bill on the minimum
      // or fuel-derived units. (perday assets are excluded — they bill on days.)
      issues.noReading.push({ code: a.code, label });
      problem = true;
    }
    if (overlapSet.has(a.id)) {
      issues.overlaps.push({ code: a.code, label, detail: "postings overlap" });
      problem = true;
    }
    if (unpricedSet.has(a.id)) {
      issues.unpricedFuel.push({ code: a.code, label });
      problem = true;
    }
    if (!problem) ready++;
  }

  return {
    year,
    month,
    periodKey: period.periodKey,
    availableFleet: assets.length,
    ready,
    issues,
  };
}
