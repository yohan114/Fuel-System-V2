import { prisma } from "../db";
import { computeWindowDelta, sumFuelForWindow } from "../billing/usage";
import { resolveInterval, dueSoonThreshold } from "./interval";

export type ServiceState = "OVERDUE" | "DUE_SOON" | "OK" | "UNKNOWN";

export interface ServiceStatus {
  assetId: string;
  code: string;
  meterType: string;
  categoryName: string;
  projectName: string | null;
  basis: "HOURS" | "KM";
  intervalValue: number;
  intervalSource: "asset" | "category" | "default";
  anchorDate: Date | null;
  lastServiceDate: Date | null;
  recordedSince: number | null;
  fuelDerivedSince: number | null;
  usedSince: number | null; // the safest (higher) of the two
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

  const fuelConsTyp = asset.rentalRate?.fuelConsTyp ?? null;
  const hasRate = !!fuelConsTyp && fuelConsTyp > 0;

  let recordedSince: number | null = null;
  let fuelDerivedSince: number | null = null;

  if (anchorDate) {
    if (lastService?.meterAtService != null) {
      const latest = await prisma.meterReading.findFirst({
        where: { assetId, readingType: basisMeter, readingDate: { lte: asOf } },
        orderBy: [{ value: "desc" }, { readingDate: "desc" }],
        select: { value: true },
      });
      recordedSince = latest ? Math.max(0, latest.value - lastService.meterAtService) : 0;
    } else {
      const rd = await computeWindowDelta(assetId, basisMeter, anchorDate, asOf, asset.project?.code);
      recordedSince = rd.delta;
    }

    if (hasRate) {
      const fuel = await sumFuelForWindow(assetId, anchorDate, asOf);
      fuelDerivedSince = fuel.litres / (fuelConsTyp as number);
    }
  }

  const candidates = [recordedSince, fuelDerivedSince].filter((x): x is number => x != null);
  const usedSince = candidates.length ? Math.max(...candidates) : null;
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
    meterType: asset.meterType,
    categoryName: asset.category.name,
    projectName: asset.project?.name ?? null,
    basis: resolved.basis,
    intervalValue: resolved.intervalValue,
    intervalSource: resolved.source,
    anchorDate,
    lastServiceDate: lastService?.serviceDate ?? null,
    recordedSince,
    fuelDerivedSince,
    usedSince,
    remaining,
    state,
    ratePerDay,
    projectedDueDate,
    hasRate,
  };
}
