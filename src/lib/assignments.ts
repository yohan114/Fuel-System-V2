import { prisma } from "./db";

// Asset → site assignment helpers.
//
// An AssetAssignment is the saved record of "which vehicle was posted to which
// site, and for what date range". It is the single source of truth for:
//   1. Data-entry visibility — a site login only sees the vehicles assigned to
//      its site for the working day ("only show vehicles in assigns").
//   2. Monthly billing — a vehicle that moved between sites in a month is split
//      into one segment per site, and each site is billed for its own slice.
//
// Dates follow the same Asia/Colombo local-midnight convention used throughout
// the billing/period/condition code: a start/end day is stored as local midnight
// and compared at day granularity. endDate is the inclusive last day; a null
// endDate means the posting is still open.

// Stable integer day index for a Date, using its local Y-M-D components. Two
// dates on the same calendar day share an index regardless of their time part.
export function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

// Local midnight (start of day) for a date.
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// Local end-of-day (last millisecond) for a date.
export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export interface MonthSegment {
  projectId: string;
  projectCode: string;
  projectName: string;
  /** Inclusive day window, clipped to the billing month. */
  start: Date;
  end: Date;
  /** Whole calendar days in the (clipped) window, inclusive of both ends. */
  days: number;
}

// The assignment that covers `date` for an asset (start ≤ date ≤ end, or open
// end). When several overlap (shouldn't normally happen) the latest start wins.
export async function getActiveAssignment(assetId: string, date: Date) {
  const dayEnd = endOfLocalDay(date);
  return prisma.assetAssignment.findFirst({
    where: {
      assetId,
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: startOfLocalDay(date) } }],
    },
    orderBy: { startDate: "desc" },
    include: { project: true },
  });
}

// The set of asset ids actively assigned to a given project on `date`. Used to
// scope a site user's vehicle lists to just their posted fleet.
export async function getAssignedAssetIds(projectId: string, date: Date): Promise<string[]> {
  const dayEnd = endOfLocalDay(date);
  const rows = await prisma.assetAssignment.findMany({
    where: {
      projectId,
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: startOfLocalDay(date) } }],
    },
    select: { assetId: true },
    distinct: ["assetId"],
  });
  return rows.map((r) => r.assetId);
}

// True when the asset has at least one assignment row (i.e. the new model is in
// use for it). Callers fall back to the legacy `Asset.projectId` pointer when an
// asset has never been assigned, so historical data keeps working unchanged.
export async function assetHasAssignments(assetId: string): Promise<boolean> {
  const n = await prisma.assetAssignment.count({ where: { assetId } });
  return n > 0;
}

// Which asset ids a project-scoped user may see/enter data for on `date`:
//   - every vehicle actively assigned to their site that day, PLUS
//   - any vehicle still pinned to their site via the legacy Asset.projectId
//     pointer that has never been given an assignment (back-compat).
// Returns null for users with no project scope (admins, allocators) — meaning
// "no restriction".
export async function visibleAssetIdsForUser(
  user: { role: string; projectId: string | null },
  date: Date = new Date()
): Promise<Set<string> | null> {
  if (user.role !== "USER" || !user.projectId) return null;

  const assigned = await getAssignedAssetIds(user.projectId, date);

  // Legacy fallback: assets pinned to this project that carry no assignment yet.
  const legacy = await prisma.asset.findMany({
    where: { projectId: user.projectId, assignments: { none: {} } },
    select: { id: true },
  });

  return new Set<string>([...assigned, ...legacy.map((a) => a.id)]);
}

// Whether a project-scoped user is allowed to log against a specific asset on
// `date`. Admins/allocators (no project scope) are always allowed.
export async function canUserAccessAsset(
  user: { role: string; projectId: string | null },
  assetId: string,
  date: Date = new Date()
): Promise<boolean> {
  const visible = await visibleAssetIdsForUser(user, date);
  if (visible === null) return true;
  return visible.has(assetId);
}

// Splits a billing month into one segment per site the asset was assigned to,
// clipped to the month. Segments are ordered by start day. Returns [] when the
// asset has no assignment overlapping the month (caller then uses the legacy
// single-site billing path).
export async function getMonthSegments(
  assetId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<MonthSegment[]> {
  const assignments = await prisma.assetAssignment.findMany({
    where: {
      assetId,
      startDate: { lte: periodEnd },
      OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
    },
    orderBy: { startDate: "asc" },
    include: { project: true },
  });
  if (assignments.length === 0) return [];

  const monthStartNum = dayNumber(periodStart);
  const monthEndNum = dayNumber(periodEnd);

  const segments: MonthSegment[] = [];
  for (const a of assignments) {
    const aStartNum = Math.max(dayNumber(a.startDate), monthStartNum);
    const aEndNum = Math.min(a.endDate ? dayNumber(a.endDate) : monthEndNum, monthEndNum);
    if (aEndNum < aStartNum) continue; // no real overlap

    // Reconstruct concrete window bounds, clamped to the month boundaries so the
    // first/last segments line up exactly with periodStart/periodEnd.
    const start = aStartNum <= monthStartNum ? periodStart : startOfLocalDay(a.startDate);
    const end = a.endDate && aEndNum < monthEndNum ? endOfLocalDay(a.endDate) : periodEnd;

    segments.push({
      projectId: a.projectId,
      projectCode: a.project.code,
      projectName: a.project.name,
      start,
      end,
      days: aEndNum - aStartNum + 1,
    });
  }
  return segments;
}
