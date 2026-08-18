import { prisma } from "../db";
import { computeWindowDelta, sumFuelForWindow } from "../billing/usage";
import { resolveInterval, dueSoonThreshold } from "./interval";
import { resolveBand } from "../consumption/band";
import { meterDeltaUsable } from "./meter-trust";

export type ServiceState = "OVERDUE" | "DUE_SOON" | "OK" | "UNKNOWN";

/** Which measurement decided "used since service". */
export type UsedSource = "meter" | "fuel" | "none";

export interface ServiceStatus {
  assetId: string;
  /** E&C number, e.g. LB-01. */
  code: string;
  /** Registration / vehicle number, e.g. ZA-2609. Not every machine has one. */
  regNo: string | null;
  meterType: string;
  categoryName: string;
  projectName: string | null;
  basis: "HOURS" | "KM";
  intervalValue: number;
  intervalSource: "asset" | "category" | "default";
  anchorDate: Date | null;
  lastServiceDate: Date | null;
  /** The meter reading taken at the last service — the baseline. */
  meterAtService: number | null;
  /** The meter on the most recent fuel issue since — the current reading. */
  currentMeter: number | null;
  recordedSince: number | null;
  /** Litres issued to the machine since its last service. */
  fuelLitresSince: number | null;
  /** How many separate fuel issues that was. */
  fuelIssuesSince: number | null;
  /** Those litres converted to work at the machine's Cons Typ rate. */
  fuelDerivedSince: number | null;
  usedSince: number | null; // the safest (higher) of the two
  /** Which measurement produced usedSince. */
  usedSource: UsedSource;
  /** Why the meter could or could not be used — shown to the workshop. */
  meterNote: string | null;
  remaining: number | null;
  state: ServiceState;
  ratePerDay: number | null;
  projectedDueDate: Date | null;
  hasRate: boolean;
}

const DAY = 86400000;

// Service status for one asset. "Used since last service" is the HIGHER of the
// recorded meter growth and the fuel-derived running (fuel ÷ typical rate) since
// the anchor — protecting machines whose meter is under-recorded.
export async function computeServiceStatus(assetId: string, asOf: Date = new Date()): Promise<ServiceStatus | null> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { category: true, project: true, rentalRate: true, serviceIntervalOverride: true },
  });
  if (!asset) return null;

  const categoryInterval = await prisma.serviceInterval.findUnique({ where: { categoryId: asset.categoryId } });
  const resolved = resolveInterval(asset.category.fleetGroup, asset.meterType, asset.serviceIntervalOverride, categoryInterval);
  const basisMeter = resolved.basis;

  const lastService = await prisma.serviceRecord.findFirst({ where: { assetId }, orderBy: { serviceDate: "desc" } });

  // Anchor = last service date, else commissioning (earliest reading / first issue).
  let anchorDate: Date | null = lastService?.serviceDate ?? null;
  if (!anchorDate) {
    const [firstReading, firstFuel] = await Promise.all([
      prisma.meterReading.findFirst({ where: { assetId }, orderBy: { readingDate: "asc" }, select: { readingDate: true } }),
      prisma.fuelIssue.findFirst({ where: { assetId, voided: false }, orderBy: { issueDate: "asc" }, select: { issueDate: true } }),
    ]);
    anchorDate = firstReading?.readingDate ?? firstFuel?.issueDate ?? null;
  }

  // The typical-consumption band may only be divided into litres when it is
  // quoted in the unit the service interval is measured in. A machine carrying
  // an L/hr band while its interval runs on kilometres would otherwise produce
  // "litres ÷ 16" labelled as kilometres — off by a factor of ~45. resolveBand
  // reports that case as not comparable rather than guessing.
  const band = resolveBand(asset.rentalRate, basisMeter);
  const fuelConsTyp = band.comparable ? band.typ : null;
  const hasRate = !!fuelConsTyp && fuelConsTyp > 0;

  let recordedSince: number | null = null;
  let fuelLitresSince: number | null = null;
  let fuelIssuesSince: number | null = null;
  let fuelDerivedSince: number | null = null;
  let meterNote: string | null = null;
  let currentMeter: number | null = null;

  if (anchorDate) {
    if (lastService?.meterAtService != null) {
      // Baseline is the meter read at the service. The current reading is the
      // meter captured on the most recent fuel issue since — fuel issues are by
      // far the densest source of readings in this fleet, denser than the
      // manual meter log. Latest BY DATE, not the largest ever recorded:
      // ordering by value let one bad reading (a pump totaliser keyed in as an
      // odometer) become a permanent high-water mark that every later service
      // status was measured against.
      const latestIssue = await prisma.fuelIssue.findFirst({
        where: {
          assetId,
          voided: false,
          readingType: basisMeter,
          meterReading: { gt: 0 },
          issueDate: { gt: anchorDate, lte: asOf },
        },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        select: { meterReading: true },
      });
      // Only subtract when both readings come off the same instrument. Some
      // machines carry two meters — DT-43's service records climb past 190,000
      // while its fuel issues read 28,600 — and subtracting across them is
      // meaningless. When that happens the fuel figure below is the evidence.
      const check = meterDeltaUsable({
        meterAtService: lastService.meterAtService,
        currentMeter: latestIssue?.meterReading ?? null,
        meterType: basisMeter,
      });
      currentMeter = latestIssue?.meterReading ?? null;
      recordedSince = check.usable ? check.delta : null;
      meterNote = latestIssue ? check.reason : "no meter has been read at a fuel issue since the service";
    } else {
      const rd = await computeWindowDelta(assetId, basisMeter, anchorDate, asOf, asset.project?.code);
      recordedSince = rd.delta;
      meterNote = "no meter was recorded at the last service — measured across the window instead";
    }

    // A machine cannot run more than 24 hours a day, and nothing in this fleet
    // covers more than ~200 km a day (the same ceilings the billing engine
    // applies). A delta beyond that is not a machine that worked hard, it is a
    // bad reading — so it is discarded rather than clamped, because clamping
    // would still let it outrank the fuel figure and drive the verdict.
    const daysSince = Math.max(1, (asOf.getTime() - new Date(anchorDate).getTime()) / DAY);
    const physicalMax = (basisMeter === "KM" ? 200 : 24) * daysSince;
    if (recordedSince != null && recordedSince > physicalMax) recordedSince = null;

    // Always count the fuel, even when no band can convert it into work — the
    // litres and the number of issues since the service are worth seeing on
    // their own, and they are the evidence behind the derived figure.
    const fuel = await sumFuelForWindow(assetId, anchorDate, asOf);
    fuelLitresSince = fuel.litres;
    fuelIssuesSince = fuel.count;
    if (hasRate) {
      fuelDerivedSince = fuel.litres / (fuelConsTyp as number);
    }
  }

  // The meter is the preferred measure — it is a direct observation. The fuel
  // figure is the fallback when no meter has been read since the service, and
  // it also OVERRIDES the meter when it is higher: a machine that burned more
  // fuel than its meter movement can account for has done more work than the
  // meter admits, and under-servicing is the expensive mistake here.
  const candidates = [recordedSince, fuelDerivedSince].filter((x): x is number => x != null);
  const usedSince = candidates.length ? Math.max(...candidates) : null;
  const usedSource: UsedSource =
    usedSince == null
      ? "none"
      : recordedSince != null && recordedSince >= (fuelDerivedSince ?? -1)
        ? "meter"
        : "fuel";
  const remaining = usedSince != null ? resolved.intervalValue - usedSince : null;

  let state: ServiceState;
  if (usedSince == null || remaining == null) state = "UNKNOWN";
  else if (remaining <= 0) state = "OVERDUE";
  else if (remaining <= dueSoonThreshold(resolved.intervalValue)) state = "DUE_SOON";
  else state = "OK";

  let ratePerDay: number | null = null;
  let projectedDueDate: Date | null = null;
  if (anchorDate && usedSince != null && usedSince > 0) {
    const days = Math.max(1, (asOf.getTime() - new Date(anchorDate).getTime()) / DAY);
    ratePerDay = usedSince / days;
    if (ratePerDay > 0 && remaining != null && remaining > 0) {
      projectedDueDate = new Date(asOf.getTime() + (remaining / ratePerDay) * DAY);
    }
  }

  return {
    assetId,
    code: asset.code,
    regNo: asset.regNo ?? null,
    meterType: asset.meterType,
    categoryName: asset.category.name,
    projectName: asset.project?.name ?? null,
    basis: resolved.basis,
    intervalValue: resolved.intervalValue,
    intervalSource: resolved.source,
    anchorDate,
    lastServiceDate: lastService?.serviceDate ?? null,
    meterAtService: lastService?.meterAtService ?? null,
    currentMeter,
    recordedSince,
    fuelLitresSince,
    fuelIssuesSince,
    fuelDerivedSince,
    usedSince,
    usedSource,
    meterNote,
    remaining,
    state,
    ratePerDay,
    projectedDueDate,
    hasRate,
  };
}
