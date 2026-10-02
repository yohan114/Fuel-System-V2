import { prisma } from "../db";
import { colomboDayKey, colomboDayStart } from "../colombo-date";

// Helper to filter meter reading sources based on project to prevent cross-contamination.
function getMeterSourcesForProject(projectCode?: string | null): string[] {
  if (!projectCode) return [];
  const common = ["MANUAL", "FUEL_ISSUE", "GOOGLE_ESTIMATE", "REPAIR_RESUME", "INSTRUMENT_RESET"];
  if (projectCode === "CEP-03-ABC") {
    return ["CEP-03-ABC_START", "CEP-03-ABC_END", ...common];
  }
  if (projectCode === "CEP-03") {
    return ["DAILY_SHEET_START", "DAILY_SHEET_END", ...common];
  }
  return [
    `SUMMARY_${projectCode}_START`,
    `SUMMARY_${projectCode}_END`,
    "SUMMARY_START",
    "SUMMARY_END",
    ...common
  ];
}

// Per-asset monthly usage derivation. The running-delta logic mirrors
// src/lib/reports/aggregate.ts:148-192 but is scoped to a single asset (no
// aggregation, no N+1 over many assets).

export interface RunningDelta {
  opening: number | null;
  closing: number | null;
  delta: number;
  outageDays?: number;
  estimatedDays?: number;
}

export interface WindowDeltaResult extends RunningDelta {
  outageDays: number;
  estimatedDays: number;
}

const DAY = 86_400_000;

// What a machine can physically record in a day. The same bounds the asset
// merge tool uses to decide whether two records could be one machine.
const MAX_PER_DAY: Record<string, number> = { KM: 1500, HOURS: 24 };

/**
 * Meter movement across a series of readings, counting only the steps a machine
 * could physically have made.
 *
 * First-to-last is not safe on this data. A digit slipped into one reading —
 * SC-10's 2,641,740 for 264,174, TM-18's 462,531 against a meter reading 0 nine
 * days earlier — makes the series climb by more than a machine can move, and
 * subtracting the ends carries the whole slip into the answer. It is the same
 * keying fault the opening/closing guard already refuses; that guard only sees
 * it when the series comes back DOWN, and a slip in the last reading never does.
 *
 * So each consecutive step is judged on its own: a step is a measurement when it
 * goes forward and stays inside a day's travel for the days it spans. Steps that
 * do not are the slip, and the step back out of one is negative, so a spike
 * contributes nothing from either side while genuine movement around it still
 * counts.
 *
 * Returns null when no step survives — the meter is unread, which is a different
 * thing from a meter that read zero movement.
 */
export function coherentMeterDelta(
  readings: { value: number; readingDate: Date }[],
  meterType: string | null | undefined,
): number | null {
  if (readings.length < 2) return null;
  const perDay = MAX_PER_DAY[meterType ?? ""] ?? MAX_PER_DAY.HOURS;

  const ordered = [...readings].sort((a, b) => a.readingDate.getTime() - b.readingDate.getTime());
  let total = 0;
  let accepted = 0;

  for (let i = 1; i < ordered.length; i++) {
    const step = ordered[i].value - ordered[i - 1].value;
    if (step < 0) continue;
    // Two readings on the same day still get one day's allowance between them.
    const spanDays = Math.max(1, (ordered[i].readingDate.getTime() - ordered[i - 1].readingDate.getTime()) / 86_400_000);
    if (step > perDay * spanDays) continue;
    total += step;
    accepted++;
  }

  return accepted > 0 ? total : null;
}

// Cumulative meter growth within [start, end] for a given meter type.
// Opening = last reading on/before the period start (anchor), falling back to
// the earliest reading inside the window. Closing = last reading on/before the
// period end. Delta is clamped to 0 when there is no forward growth (guards
// against odometer resets / back-dated corrections).
// Resolves meter growth across a billing window [start, end], handling:
// - Standard continuous physical meters
// - Outage windows with Google-estimated readings
// - Instrument replacement / reset epochs (prevents cross-epoch false subtraction)
// - Sub-window delta accumulation clamped by physical ceilings
export async function resolveWindowDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<WindowDeltaResult> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { project: true },
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
      const values = manualReadings.map((r) => r.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      return {
        opening: minVal,
        closing: maxVal,
        delta: sum,
        outageDays: 0,
        estimatedDays: 0,
      };
    }
  }

  // 1. Fetch outages overlapping the period [start, end]
  const outages = await prisma.meterOutage.findMany({
    where: {
      assetId,
      startDate: { lte: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    },
    orderBy: { startDate: "asc" },
  });

  let outageDays = 0;
  for (const o of outages) {
    const oStart = o.startDate < start ? start : o.startDate;
    const oEnd = !o.endDate || o.endDate > end ? end : o.endDate;
    const days = Math.max(
      1,
      Math.round(
        (colomboDayStart(colomboDayKey(oEnd)).getTime() -
          colomboDayStart(colomboDayKey(oStart)).getTime()) /
          DAY
      ) + 1
    );
    outageDays += days;
  }

  // 2. Check for instrument epoch: find latest INSTRUMENT_RESET on or before start
  const resetBeforeStart = await prisma.meterReading.findFirst({
    where: {
      assetId,
      readingType: meterType,
      source: "INSTRUMENT_RESET",
      readingDate: { lte: start },
    },
    orderBy: { readingDate: "desc" },
  });
  const epochStart = resetBeforeStart?.readingDate ?? null;

  // Check if any replacement occurred during [start, end]
  const replacedInWindow =
    outages.some(
      (o) =>
        o.instrumentContinuity === "replaced" &&
        o.endDate &&
        o.endDate >= start &&
        o.endDate <= end
    ) ||
    (await prisma.meterReading.findFirst({
      where: {
        assetId,
        readingType: meterType,
        source: "INSTRUMENT_RESET",
        readingDate: { gt: start, lte: end },
      },
    })) !== null;

  const allowedSources = getMeterSourcesForProject(projectCode || asset?.project?.code);
  const epochFilter = epochStart ? { readingDate: { gte: epochStart } } : {};

  // If no outages and no replacement in window: standard fast path
  if (outages.length === 0 && !replacedInWindow) {
    const closing = await prisma.meterReading.findFirst({
      where: {
        assetId,
        readingType: meterType,
        readingDate: { lte: end },
        ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
        ...epochFilter,
      },
      orderBy: [{ readingDate: "desc" }, { value: "desc" }],
    });

    if (!closing) {
      return { opening: null, closing: null, delta: 0, outageDays: 0, estimatedDays: 0 };
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
        ...compatibilityFilter,
        ...epochFilter,
      },
      orderBy: [{ readingDate: "desc" }, { value: "desc" }],
    });

    const thresholdDate = new Date(start.getTime() - 31 * DAY);
    if (!opening || opening.readingDate < thresholdDate) {
      const fallback = await prisma.meterReading.findFirst({
        where: {
          assetId,
          readingType: meterType,
          readingDate: { gte: start, lte: end },
          ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
          ...compatibilityFilter,
          ...epochFilter,
        },
        orderBy: [{ readingDate: "asc" }, { value: "asc" }],
      });
      if (fallback) {
        opening = fallback;
      }
    }

    if (opening && closing && closing.value < opening.value) {
      return { opening: null, closing: null, delta: 0, outageDays: 0, estimatedDays: 0 };
    }

    let delta = 0;
    if (opening && closing && closing.value > opening.value) {
      delta = closing.value - opening.value;
    }

    const estimatedCount = await prisma.meterReading.count({
      where: {
        assetId,
        readingType: meterType,
        source: "GOOGLE_ESTIMATE",
        readingDate: { gte: start, lte: end },
      },
    });

    return {
      opening: opening ? opening.value : null,
      closing: closing ? closing.value : null,
      delta,
      outageDays: 0,
      estimatedDays: estimatedCount > 0 ? estimatedCount : 0,
    };
  }

  // 3. Multi-subwindow path across outages:
  const allReadings = await prisma.meterReading.findMany({
    where: {
      assetId,
      readingType: meterType,
      readingDate: {
        gte: new Date(start.getTime() - 31 * DAY),
        lte: end,
      },
      ...(allowedSources.length > 0 ? { source: { in: allowedSources } } : {}),
    },
    orderBy: [{ readingDate: "asc" }, { value: "asc" }],
  });

  const googleDates = new Set(
    allReadings
      .filter((r) => r.source === "GOOGLE_ESTIMATE" && r.readingDate >= start && r.readingDate <= end)
      .map((r) => colomboDayKey(r.readingDate))
  );
  const estimatedDays = Math.max(outageDays, googleDates.size);

  let totalDelta = 0;
  const sortedOutages = [...outages].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  interface SubWindow {
    type: "PHYSICAL" | "GOOGLE";
    subStart: Date;
    subEnd: Date;
  }
  const subWindows: SubWindow[] = [];
  let cur = start;

  for (const o of sortedOutages) {
    const oStart = o.startDate < cur ? cur : o.startDate;
    const oEnd = !o.endDate || o.endDate > end ? end : o.endDate;

    if (oStart > cur) {
      subWindows.push({ type: "PHYSICAL", subStart: cur, subEnd: oStart });
    }
    subWindows.push({
      type: "GOOGLE",
      subStart: oStart,
      subEnd: oEnd,
    });
    cur = oEnd;
    if (cur >= end) break;
  }

  if (cur < end) {
    subWindows.push({ type: "PHYSICAL", subStart: cur, subEnd: end });
  }

  for (const sw of subWindows) {
    const swDays = Math.max(1, (sw.subEnd.getTime() - sw.subStart.getTime()) / DAY);
    const maxAllowed = (meterType === "KM" ? 200 : 24) * swDays;

    if (sw.type === "GOOGLE") {
      const gReadings = allReadings.filter(
        (r) => r.readingDate >= sw.subStart && r.readingDate <= sw.subEnd
      );
      if (gReadings.length >= 2) {
        const deltaG = gReadings[gReadings.length - 1].value - gReadings[0].value;
        if (deltaG > 0 && deltaG <= maxAllowed) {
          totalDelta += deltaG;
        }
      }
    } else {
      const pReadings = allReadings.filter(
        (r) => r.source !== "GOOGLE_ESTIMATE" && r.readingDate >= sw.subStart && r.readingDate <= sw.subEnd
      );
      if (pReadings.length >= 2) {
        const deltaP = pReadings[pReadings.length - 1].value - pReadings[0].value;
        if (deltaP > 0 && deltaP <= maxAllowed) {
          totalDelta += deltaP;
        }
      } else if (pReadings.length === 1) {
        const prev = allReadings
          .filter((r) => r.source !== "GOOGLE_ESTIMATE" && r.readingDate <= sw.subStart)
          .pop();
        if (prev && pReadings[0].value > prev.value) {
          const deltaP = pReadings[0].value - prev.value;
          if (deltaP <= maxAllowed) totalDelta += deltaP;
        }
      }
    }
  }

  let openingVal: number | null = null;
  let closingVal: number | null = null;

  if (!replacedInWindow) {
    const validReadings = allReadings.filter((r) => r.readingDate >= start && r.readingDate <= end);
    if (validReadings.length > 0) {
      openingVal = validReadings[0].value;
      closingVal = validReadings[validReadings.length - 1].value;
      if (closingVal < openingVal) {
        openingVal = null;
        closingVal = null;
      }
    }
  }

  return {
    opening: openingVal,
    closing: closingVal,
    delta: Math.round(totalDelta * 10) / 10,
    outageDays,
    estimatedDays,
  };
}

// Cumulative meter growth within [start, end] for a given meter type.
export async function computeRunningDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<WindowDeltaResult> {
  return resolveWindowDelta(assetId, meterType, start, end, projectCode);
}

// Cumulative meter growth across an arbitrary [start, end] window, source-aware.
export async function computeWindowDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date,
  projectCode?: string | null
): Promise<WindowDeltaResult> {
  return resolveWindowDelta(assetId, meterType, start, end, projectCode);
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
