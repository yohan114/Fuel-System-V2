import { prisma } from "./db";
import { isSiteUser } from "./roles";

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

// Stable integer day index for a Date, on the COLOMBO calendar. Two dates on the
// same Sri Lankan day share an index regardless of their time part.
//
// This used to read the server's Y-M-D, which is only the same thing when the
// server runs on Colombo time. On a UTC host every imported row — stored at
// Colombo midnight, i.e. 18:30Z the day before — indexed to the previous day, so
// a posting that ended 31 July still claimed the 1st of August. The site shown
// against a fuel issue, and the site billed for it, were both a day out at every
// month boundary; a vehicle's first day at a new site was credited to the old
// one. The comment above this function has always said Asia/Colombo — now the
// code does too.
export function dayNumber(d: Date): number {
  const [y, m, day] = d
    .toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" })   // YYYY-MM-DD
    .split("-")
    .map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
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
  /** Per-allocation hire type ("DRY" | "WET") and driver, if set. */
  billingType: string | null;
  driverName: string | null;
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
  if (!isSiteUser(user.role) || !user.projectId) return null;

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

// One assignment clipped to the billing month, as day indices, for the pure
// overlap resolver below.
export interface AssignmentSpan {
  projectId: string;
  projectCode: string;
  projectName: string;
  startDay: number; // inclusive, already clipped to the month
  endDay: number; // inclusive, already clipped to the month
  startMs: number; // original startDate — latest start wins on overlap
  createdMs: number; // tiebreak when two postings share a start date
  billingType: string | null;
  driverName: string | null;
}

// A coalesced run of consecutive days owned by one site.
export interface DayRun {
  projectId: string;
  projectCode: string;
  projectName: string;
  startDay: number;
  endDay: number;
  days: number;
  billingType: string | null;
  driverName: string | null;
}

// Assigns every calendar day in [monthStart, monthEnd] to exactly ONE site — the
// posting that covers it with the latest start date (a re-posting supersedes an
// earlier one; createdAt breaks a tie) — then coalesces consecutive same-site
// days into runs. This is what makes the month's segments NON-OVERLAPPING: a
// vehicle double-booked to several sites can never be charged more than the
// month's calendar days, so rental, fuel and the guaranteed minimum are each
// counted exactly once. Pure and unit-tested.
export function resolveDayRuns(
  spans: AssignmentSpan[],
  monthStart: number,
  monthEnd: number
): DayRun[] {
  const runs: DayRun[] = [];
  let cur: DayRun | null = null;
  for (let d = monthStart; d <= monthEnd; d++) {
    let owner: AssignmentSpan | null = null;
    for (const s of spans) {
      if (s.startDay <= d && s.endDay >= d) {
        if (
          !owner ||
          s.startMs > owner.startMs ||
          (s.startMs === owner.startMs && s.createdMs > owner.createdMs)
        ) {
          owner = s;
        }
      }
    }
    if (!owner) {
      if (cur) { runs.push(cur); cur = null; }
      continue;
    }
    if (cur && cur.projectId === owner.projectId) {
      cur.endDay = d;
      cur.days++;
    } else {
      if (cur) runs.push(cur);
      cur = {
        projectId: owner.projectId,
        projectCode: owner.projectCode,
        projectName: owner.projectName,
        startDay: d,
        endDay: d,
        days: 1,
        billingType: owner.billingType,
        driverName: owner.driverName,
      };
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

// Splits a billing month into non-overlapping segments — one per contiguous run
// of days the asset was posted to a single site (see resolveDayRuns). Returns []
// when the asset has no assignment overlapping the month (caller then uses the
// legacy single-site billing path).
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

  const spans: AssignmentSpan[] = [];
  for (const a of assignments) {
    const startDay = Math.max(dayNumber(a.startDate), monthStartNum);
    const endDay = Math.min(a.endDate ? dayNumber(a.endDate) : monthEndNum, monthEndNum);
    if (endDay < startDay) continue; // no real overlap with the month
    spans.push({
      projectId: a.projectId,
      projectCode: a.project.code,
      projectName: a.project.name,
      startDay,
      endDay,
      startMs: a.startDate.getTime(),
      createdMs: a.createdAt.getTime(),
      billingType: a.billingType,
      driverName: a.driverName,
    });
  }

  const runs = resolveDayRuns(spans, monthStartNum, monthEndNum);

  // Reconstruct concrete Date bounds per run, clamped to the month boundaries so
  // the first/last segments line up exactly with periodStart/periodEnd.
  const dayToLocalMidnight = (dayNum: number): Date =>
    new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + (dayNum - monthStartNum), 0, 0, 0, 0);

  return runs.map((r) => ({
    projectId: r.projectId,
    projectCode: r.projectCode,
    projectName: r.projectName,
    start: r.startDay <= monthStartNum ? periodStart : dayToLocalMidnight(r.startDay),
    end: r.endDay >= monthEndNum ? periodEnd : endOfLocalDay(dayToLocalMidnight(r.endDay)),
    days: r.days,
    billingType: r.billingType,
    driverName: r.driverName,
  }));
}
