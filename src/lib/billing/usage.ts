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
  return [
    `SUMMARY_${projectCode}_START`,
    `SUMMARY_${projectCode}_END`,
    "SUMMARY_START",
    "SUMMARY_END",
    "MANUAL",
    "FUEL_ISSUE"
  ];
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

  const closing = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: end },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {})
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  if (!closing) {
    return { opening: null, closing: null, delta: 0 };
  }

  const isClosingAbc = closing.source?.startsWith("CEP-03-ABC") ?? false;
  const compatibilityFilter = isClosingAbc
    ? { source: { startsWith: "CEP-03-ABC" } }
    : { NOT: { source: { startsWith: "CEP-03-ABC" } } };

  let opening = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: start },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
      ...compatibilityFilter
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  const thresholdDate = new Date(start.getTime() - 31 * 24 * 60 * 60 * 1000);
  if (!opening || opening.readingDate < thresholdDate) {
    const fallback = await prisma.meterReading.findFirst({
      where: { 
        assetId, 
        readingType: meterType, 
        readingDate: { gte: start, lte: end },
        ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
        ...compatibilityFilter
      },
      orderBy: [{ readingDate: "asc" }, { value: "asc" }],
    });
    if (fallback) {
      opening = fallback;
    }
  }

  // A closing reading below its opening cannot describe one machine's month: a
  // meter counts up. The charge was already safe — delta stayed 0 and the bill
  // fell to the guaranteed minimum — but the pair was still returned, so eleven
  // draft invoices printed things like "opening 2,641,740, closing 265,980" for
  // a client to read. An unusable meter must report nothing rather than a figure
  // nobody can defend across a table.
  //
  // The cause is almost always a keying slip in the source sheet — a digit added
  // (SC-10's 2,641,740 for 264,174) or dropped (HCC-07's 33,972 for 383,xxx) —
  // or a meter that was physically replaced and restarted low. None of those are
  // measurements of this month's work.
  if (opening && closing && closing.value < opening.value) {
    return { opening: null, closing: null, delta: 0 };
  }

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
// aware. Used for per-site billing segments: a vehicle is one physical meter,
// so its growth while posted to a site is simply closing(window) − opening(window)
// calculated within its compatible/allowed site sources.
export async function computeWindowDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<RunningDelta> {
  const allowedSources = getMeterSourcesForProject(projectCode);

  const closing = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: end },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {})
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  if (!closing) {
    return { opening: null, closing: null, delta: 0 };
  }

  const isClosingAbc = closing.source?.startsWith("CEP-03-ABC") ?? false;
  const compatibilityFilter = isClosingAbc
    ? { source: { startsWith: "CEP-03-ABC" } }
    : { NOT: { source: { startsWith: "CEP-03-ABC" } } };

  let opening = await prisma.meterReading.findFirst({
    where: { 
      assetId, 
      readingType: meterType, 
      readingDate: { lte: start },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
      ...compatibilityFilter
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
  });

  const threshold = new Date(start.getTime() - 31 * 24 * 60 * 60 * 1000);
  if (!opening || opening.readingDate < threshold) {
    const fallback = await prisma.meterReading.findFirst({
      where: { 
        assetId, 
        readingType: meterType, 
        readingDate: { gte: start, lte: end },
        ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
        ...compatibilityFilter
      },
      orderBy: [{ readingDate: "asc" }, { value: "asc" }],
    });
    if (fallback) {
      opening = fallback;
    }
  }

  // Same rule as computeRunningDelta: a meter that reads lower at the end of the
  // window than at the start is not a measurement, so report nothing rather than
  // a pair a client would query.
  if (opening && closing && closing.value < opening.value) {
    return { opening: null, closing: null, delta: 0 };
  }

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
    where: { assetId, issueDate: { gte: start, lte: end }, voided: false },
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

// sumFuelForMonth used to live here. It duplicated sumFuelForWindow but ANDed
// `source: <projectCode>` into the aggregate, on the theory that FuelIssue.source
// names a site. It does not: source records where the fuel came from — the tank
// name the pump wrote, or an importer provenance string like "Consolidated
// register (Marawila)". Zero of the 8,226 issues in the live database carry a
// source equal to any of the 33 Project.code values, so whenever the asset had a
// project pin the filter matched nothing and the function returned litres 0.
//
// That contradicted sumFuelForWindow's stated rule directly above ("fuel follows
// the vehicle... attributed purely by date") and broke the legacy single-site
// path in generate.ts two ways: wet-basis bills silently lost their whole fuel
// charge, and the phantom-bill guard's `fuel.litres === 0` test was vacuously
// true, so assets with real fuel but no meter movement were skipped and never
// invoiced. On current data 4 wet-basis drafts were short by Rs. 275,460.
//
// generate.ts now calls sumFuelForWindow for the whole-month window too, so both
// billing paths share one implementation and cannot drift apart again.
