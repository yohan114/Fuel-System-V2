import { prisma } from "../db";

// Helper to filter meter reading sources based on project to prevent cross-contamination.
function getMeterSourcesForProject(projectCode?: string | null): string[] {
  if (!projectCode) return [];
  if (projectCode === "CEP-03-ABC") {
    return ["CEP-03-ABC_START", "CEP-03-ABC_END"];
  }
  if (projectCode === "CEP-03") {
    return ["DAILY_SHEET_START", "DAILY_SHEET_END"];
  }
  return ["SUMMARY_START", "SUMMARY_END"];
}

// Per-asset monthly usage derivation. The running-delta logic mirrors
// src/lib/reports/aggregate.ts:148-192 but is scoped to a single asset (no
// aggregation, no N+1 over many assets).

export interface RunningDelta {
  opening: number | null;
  closing: number | null;
  delta: number;
}

// Cumulative meter growth within [start, end] for a given meter type.
// Opening = last reading on/before the period start (anchor), falling back to
// the earliest reading inside the window. Closing = last reading on/before the
// period end. Delta is clamped to 0 when there is no forward growth (guards
// against odometer resets / back-dated corrections).
export async function computeRunningDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<RunningDelta> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { project: true }
  });
  const isGampaha = asset?.project?.code === "GB";

  if (isGampaha) {
    const manualReadings = await prisma.meterReading.findMany({
      where: {
        assetId,
        readingType: meterType,
        source: "MANUAL",
        readingDate: { gte: start, lte: end },
      },
    });

    if (manualReadings.length > 0) {
      const sum = manualReadings.reduce((acc, r) => acc + r.value, 0);
      const values = manualReadings.map(r => r.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      return {
        opening: minVal,
        closing: maxVal,
        delta: sum,
      };
    }
  }

  const allowedSources = getMeterSourcesForProject(projectCode || asset?.project?.code);

  let opening = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: start },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {})
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  const thresholdDate = new Date(start.getTime() - 31 * 24 * 60 * 60 * 1000);
  if (!opening || opening.readingDate < thresholdDate) {
    opening = await prisma.meterReading.findFirst({
      where: { 
        assetId, 
        readingType: meterType, 
        readingDate: { gte: start, lte: end },
        ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {})
      },
      orderBy: [{ readingDate: "asc" }, { value: "asc" }],
    });
  }

  const closing = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: end },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {})
    },
    orderBy: [{ value: "desc" }, { readingDate: "desc" }],
  });

  let delta = 0;
  if (opening && closing && closing.value > opening.value) {
    delta = closing.value - opening.value;
  }

  return {
    opening: opening ? opening.value : null,
    closing: closing ? closing.value : null,
    delta,
  };
}

// Cumulative meter growth across an arbitrary [start, end] window, source-
// agnostic. Used for per-site billing segments: a vehicle is one physical meter,
// so its growth while posted to a site is simply closing(window) − opening(window)
// regardless of which site's sheet recorded each reading. Attribution to the
// right site comes from the assignment date window, not the reading source.
export async function computeWindowDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date
): Promise<RunningDelta> {
  let opening = await prisma.meterReading.findFirst({
    where: { assetId, readingType: meterType, readingDate: { lte: start } },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  // If there is no anchor close to the window start, fall back to the earliest
  // reading inside the window so a brand-new segment still measures its growth.
  const threshold = new Date(start.getTime() - 31 * 24 * 60 * 60 * 1000);
  if (!opening || opening.readingDate < threshold) {
    opening = await prisma.meterReading.findFirst({
      where: { assetId, readingType: meterType, readingDate: { gte: start, lte: end } },
      orderBy: [{ readingDate: "asc" }, { value: "asc" }],
    });
  }

  const closing = await prisma.meterReading.findFirst({
    where: { assetId, readingType: meterType, readingDate: { lte: end } },
    orderBy: [{ value: "desc" }, { readingDate: "desc" }],
  });

  let delta = 0;
  if (opening && closing && closing.value > opening.value) {
    delta = closing.value - opening.value;
  }
  return {
    opening: opening ? opening.value : null,
    closing: closing ? closing.value : null,
    delta,
  };
}

// Total fuel issued + cost for the asset within an arbitrary [start, end]
// window, source-agnostic. "Fuel follows the vehicle": an issue drawn from the
// Badalgama main pump (or anywhere) counts for whichever site the vehicle was
// assigned to on the issue date, so it is attributed purely by date here.
export async function sumFuelForWindow(
  assetId: string,
  start: Date,
  end: Date
): Promise<FuelSummary> {
  const agg = await prisma.fuelIssue.aggregate({
    where: { assetId, issueDate: { gte: start, lte: end } },
    _sum: { litres: true, totalCost: true },
    _count: true,
  });
  return {
    litres: agg._sum.litres ?? 0,
    costCents: agg._sum.totalCost ?? 0,
    count: agg._count ?? 0,
  };
}

// Number of days the asset was logged as WORKING within the period.
export async function countWorkingDays(
  assetId: string,
  start: Date,
  end: Date
): Promise<number> {
  return prisma.dailyCondition.count({
    where: { assetId, status: "WORKING", logDate: { gte: start, lte: end } },
  });
}

export interface FuelSummary {
  litres: number;
  costCents: number;
  count: number;
}

// Total fuel issued + cost for the asset in the period. costCents comes straight
// from the priced FuelIssue snapshots, so no re-pricing is required.
export async function sumFuelForMonth(
  assetId: string,
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<FuelSummary> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { project: true }
  });
  const projectCodeVal = projectCode || asset?.project?.code;
  const fuelSource = projectCodeVal === "BADAL" ? "BADALGAMA" : projectCodeVal;

  const agg = await prisma.fuelIssue.aggregate({
    where: { 
      assetId, 
      issueDate: { gte: start, lte: end },
      ...(fuelSource ? { source: fuelSource } : {})
    },
    _sum: { litres: true, totalCost: true },
    _count: true,
  });
  return {
    litres: agg._sum.litres ?? 0,
    costCents: agg._sum.totalCost ?? 0,
    count: agg._count ?? 0,
  };
}
