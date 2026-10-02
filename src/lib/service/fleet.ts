import { prisma } from "../db";
import { computeServiceStatus, type ServiceStatus, type ServiceState } from "./compute";
import { resolveInterval, dueSoonThreshold } from "./interval";
import { resolveBand } from "../consumption/band";
import { meterDeltaUsable } from "./meter-trust";

export interface FleetService {
  rows: ServiceStatus[];
  counts: { overdue: number; dueSoon: number; ok: number; unknown: number; tracked: number };
}

const DAY = 86_400_000;

// Service status across the in-service fleet (active assets with any reading or
// fuel issue).
//
// The old implementation looped the active fleet and awaited computeServiceStatus
// (one asset → 5-7 Prisma round-trips) sequentially. On a ~200-asset fleet that
// was ~1,200 round-trips per /service click, by far the slowest page in the app.
//
// This version pre-fetches every input the per-asset computation needs in a
// fixed number of bulk queries (independent of fleet size), groups the inputs by
// assetId in memory, and runs the same decision logic without hitting the DB
// again — except for the rare fallback path where no last service exists OR the
// last service has no meter reading recorded (then computeServiceStatus for just
// that one asset, which runs computeWindowDelta against the project-specific
// allowed meter sources).
export async function getFleetServiceStatus(opts: { asOf?: Date; projectId?: string } = {}): Promise<FleetService> {
  const asOf = opts.asOf ?? new Date();

  // 1. Active assets, with everything the compute step reads off the asset.
  const active = await prisma.asset.findMany({
    where: { status: "ACTIVE", ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    include: {
      category: true,
      project: true,
      rentalRate: true,
      serviceIntervalOverride: true,
    },
  });
  if (active.length === 0) {
    return { rows: [], counts: { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, tracked: 0 } };
  }
  const activeIds = active.map((a) => a.id);

  // 2. "In service" = any meter reading OR any non-voided fuel issue ever.
  //    Two distinct scans → one `in` list of ids each. Previously these also
  //    fed only the loop, which is fine; keeping it here as the gating set.
  const [readIds, fuelIdsAll] = await Promise.all([
    prisma.meterReading.findMany({ where: { assetId: { in: activeIds } }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.fuelIssue.findMany({ where: { assetId: { in: activeIds }, voided: false }, select: { assetId: true }, distinct: ["assetId"] }),
  ]);
  const inServiceSet = new Set<string>([...readIds.map((r) => r.assetId), ...fuelIdsAll.map((r) => r.assetId)]);
  const assets = active.filter((a) => inServiceSet.has(a.id));
  if (assets.length === 0) {
    return { rows: [], counts: { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, tracked: 0 } };
  }
  const assetIds = assets.map((a) => a.id);
  const uniqueCategoryIds = [...new Set(assets.map((a) => a.categoryId))];

  // 3-6. Everything else runs in parallel.
  const [categoryIntervals, serviceRecords, firstReadingRows, firstFuelRows, issueRows] =
    await Promise.all([
      prisma.serviceInterval.findMany({ where: { categoryId: { in: uniqueCategoryIds } } }),
      // All service records newest-first; we take [0] per asset in memory.
      prisma.serviceRecord.findMany({
        where: { assetId: { in: assetIds } },
        orderBy: { serviceDate: "desc" },
        select: { assetId: true, serviceDate: true, meterAtService: true },
      }),
      // Earliest reading date per asset (anchor fallback when no service exists).
      prisma.meterReading.groupBy({
        by: ["assetId"],
        where: { assetId: { in: assetIds } },
        _min: { readingDate: true },
      }),
      // Earliest fuel issue date per asset (second anchor fallback).
      prisma.fuelIssue.groupBy({
        by: ["assetId"],
        where: { assetId: { in: assetIds }, voided: false },
        _min: { issueDate: true },
      }),
      // All non-voided issues for the active fleet, lean. On a 200-asset fleet
      // with a year of history this is at most low tens of thousands of rows —
      // one indexed scan is dramatically cheaper than two per-asset findFirsts.
      prisma.fuelIssue.findMany({
        where: { assetId: { in: assetIds }, voided: false, issueDate: { lte: asOf } },
        select: {
          assetId: true,
          issueDate: true,
          litres: true,
          meterReading: true,
          readingType: true,
          createdAt: true,
        },
        orderBy: { issueDate: "asc" },
      }),
    ]);

  // Index for O(1) per-asset lookup.
  const categoryIntervalByCat = new Map(categoryIntervals.filter((c) => c.categoryId).map((c) => [c.categoryId!, c]));
  const latestServiceByAsset = new Map<string, (typeof serviceRecords)[number]>();
  for (const sr of serviceRecords) {
    // serviceRecords is already desc; keep the first one seen per asset.
    if (!latestServiceByAsset.has(sr.assetId)) latestServiceByAsset.set(sr.assetId, sr);
  }
  const firstReadingByAsset = new Map(firstReadingRows.map((r) => [r.assetId, r._min.readingDate]));
  const firstFuelByAsset = new Map(firstFuelRows.map((r) => [r.assetId, r._min.issueDate]));
  const issuesByAsset = new Map<string, typeof issueRows>();
  for (const i of issueRows) {
    const list = issuesByAsset.get(i.assetId);
    if (list) list.push(i);
    else issuesByAsset.set(i.assetId, [i]);
  }

  // Per-asset compute, in memory. One asset falls through to the per-asset
  // query path when a last service exists but has no meter reading recorded —
  // computeServiceStatus then uses computeWindowDelta, which needs the project-
  // specific allowed meter sources; batching that correctly across every site
  // is Phase 2+ work and this case is rare enough that the fallback is cheap.
  const rows: ServiceStatus[] = [];
  const fallbackIds: string[] = [];

  for (const asset of assets) {
    const lastService = latestServiceByAsset.get(asset.id) ?? null;
    if (lastService && lastService.meterAtService == null) {
      fallbackIds.push(asset.id);
      continue;
    }

    const categoryInterval = categoryIntervalByCat.get(asset.categoryId) ?? null;
    const resolved = resolveInterval(
      asset.category.fleetGroup,
      asset.meterType,
      asset.serviceIntervalOverride,
      categoryInterval,
    );
    const basisMeter = resolved.basis;

    // Anchor = last service date, else first reading, else first fuel issue.
    const anchorDate: Date | null =
      lastService?.serviceDate ??
      firstReadingByAsset.get(asset.id) ??
      firstFuelByAsset.get(asset.id) ??
      null;

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
      const assetIssues = issuesByAsset.get(asset.id) ?? [];
      // Fuel sum / count since the anchor (voided already filtered out at fetch).
      let litres = 0;
      let count = 0;
      // Latest matching issue since the anchor — same tiebreak as the SQL
      // version: by issueDate desc, then createdAt desc. We walk once from
      // the end (list is asc) and track the first match.
      let latestMatch: { issueDate: Date; meterReading: number | null; createdAt: Date } | null = null;
      for (let k = assetIssues.length - 1; k >= 0; k--) {
        const i = assetIssues[k];
        if (i.issueDate > anchorDate && i.issueDate <= asOf) {
          if (
            latestMatch == null &&
            i.readingType === basisMeter &&
            i.meterReading != null &&
            i.meterReading > 0
          ) {
            latestMatch = { issueDate: i.issueDate, meterReading: i.meterReading, createdAt: i.createdAt };
          }
          litres += i.litres;
          count += 1;
        }
      }
      fuelLitresSince = litres;
      fuelIssuesSince = count;
      if (hasRate) fuelDerivedSince = litres / (fuelConsTyp as number);

      if (lastService?.meterAtService != null) {
        const check = meterDeltaUsable({
          meterAtService: lastService.meterAtService,
          currentMeter: latestMatch?.meterReading ?? null,
          meterType: basisMeter,
        });
        currentMeter = latestMatch?.meterReading ?? null;
        recordedSince = check.usable ? check.delta : null;
        meterNote = latestMatch ? check.reason : "no meter has been read at a fuel issue since the service";
      }

      // Physical ceiling (same bound as the original): discard a delta that
      // exceeds what the machine could record in the elapsed days — it is a
      // bad reading, not hard work.
      const daysSince = Math.max(1, (asOf.getTime() - new Date(anchorDate).getTime()) / DAY);
      const physicalMax = (basisMeter === "KM" ? 200 : 24) * daysSince;
      if (recordedSince != null && recordedSince > physicalMax) recordedSince = null;
    }

    const candidates = [recordedSince, fuelDerivedSince].filter((x): x is number => x != null);
    const usedSince = candidates.length ? Math.max(...candidates) : null;
    const usedSource: "meter" | "fuel" | "none" =
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

    rows.push({
      assetId: asset.id,
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
    });
  }

  // Fallback for the uncommon no-meter-at-service case — kept per-asset for
  // correctness (computeWindowDelta pulls project-specific meter sources). This
  // list is typically a handful of machines, not the whole fleet.
  if (fallbackIds.length > 0) {
    const fallbackRows = await Promise.all(
      fallbackIds.map((id) => computeServiceStatus(id, asOf)),
    );
    for (const s of fallbackRows) if (s) rows.push(s);
  }

  const order: Record<ServiceState, number> = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNKNOWN: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.remaining ?? 1e9) - (b.remaining ?? 1e9));

  const counts = { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, tracked: rows.length };
  for (const r of rows) {
    if (r.state === "OVERDUE") counts.overdue++;
    else if (r.state === "DUE_SOON") counts.dueSoon++;
    else if (r.state === "OK") counts.ok++;
    else counts.unknown++;
  }

  return { rows, counts };
}
