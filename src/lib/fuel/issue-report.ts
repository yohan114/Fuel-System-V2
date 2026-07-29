import { prisma } from "../db";
import { isSiteUser } from "../roles";
import { indexAssignments, assignedSiteOn } from "./site-attribution";

// Shared query behind the Fuel Issue Report: the on-screen table, the PDF and
// the Excel workbook all call this, so a download can never disagree with what
// the operator just looked at on screen.
//
// Site attribution follows the vehicle's ALLOCATED site on the day of the
// issue — not the pump the fuel was drawn from. The Badalgama workshop pump
// fuels vehicles from any site, so "which site does this litre belong to" is
// always an assignment question, never a pump question.

export interface FuelReportFilters {
  from: Date;
  to: Date;
  /** Project id to restrict to, or null for every site. */
  siteId?: string | null;
  /** Free-text vehicle match against E&C code or registration number. */
  vehicle?: string | null;
  fuelKind?: string | null;
  /** Include soft-voided issues (excluded by default, as in billing). */
  includeVoided?: boolean;
}

export interface FuelReportRow {
  id: string;
  issueDate: Date;
  assetCode: string;
  assetRegNo: string | null;
  siteName: string | null;
  siteCode: string | null;
  fuelKind: string;
  litres: number;
  pricePerLitreCents: number;
  totalCostCents: number;
  meterReading: number | null;
  readingType: string | null;
  issuedByName: string;
  source: string;
  voided: boolean;
}

export interface FuelReport {
  rows: FuelReportRow[];
  totals: {
    litres: number;
    costCents: number;
    issueCount: number;
    vehicleCount: number;
  };
  /** True when the row cap was hit, so callers can say so rather than imply completeness. */
  truncated: boolean;
}

/** Hard cap so a wide date range cannot exhaust memory in a PDF render. */
export const REPORT_ROW_LIMIT = 5000;

type Viewer = { role: string; projectId: string | null };

/**
 * Resolves the site a viewer is allowed to see. Site users (USER / SITE_PUMP)
 * are pinned to their own site regardless of what they ask for; privileged
 * roles get whatever they filtered on. A site user with no site is given a
 * sentinel that matches nothing, so scoping fails closed rather than open.
 */
export function effectiveSiteId(viewer: Viewer, requestedSiteId?: string | null): string | null {
  if (isSiteUser(viewer.role)) return viewer.projectId ?? "__no_site__";
  return requestedSiteId || null;
}

export async function buildFuelIssueReport(
  filters: FuelReportFilters,
  viewer: Viewer,
): Promise<FuelReport> {
  const siteId = effectiveSiteId(viewer, filters.siteId);

  const where: Record<string, unknown> = {
    issueDate: { gte: filters.from, lte: filters.to },
  };
  if (filters.fuelKind) where.fuelKind = filters.fuelKind;
  if (!filters.includeVoided) where.voided = false;

  const vehicle = filters.vehicle?.trim().toUpperCase();
  if (vehicle) {
    where.asset = {
      OR: [{ code: { contains: vehicle } }, { regNo: { contains: vehicle } }],
    };
  }

  // Narrow to vehicles ever posted to (or pinned to) the site before the exact
  // per-issue attribution runs below — the same two-stage approach the fuel
  // issues log uses, so the two views agree.
  if (siteId) {
    const [spans, pinned] = await Promise.all([
      prisma.assetAssignment.findMany({
        where: { projectId: siteId },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.asset.findMany({ where: { projectId: siteId }, select: { id: true } }),
    ]);
    where.assetId = { in: [...new Set([...spans.map((s) => s.assetId), ...pinned.map((a) => a.id)])] };
  }

  const issues = await prisma.fuelIssue.findMany({
    where,
    omit: { photoData: true },
    include: {
      asset: { select: { code: true, regNo: true, projectId: true, project: { select: { name: true, code: true } } } },
      issuedBy: { select: { name: true } },
    },
    orderBy: { issueDate: "desc" },
    take: REPORT_ROW_LIMIT + 1,
  });

  const truncated = issues.length > REPORT_ROW_LIMIT;
  const page = truncated ? issues.slice(0, REPORT_ROW_LIMIT) : issues;

  // Resolve each issue's allocated site as at its own issue date.
  const assetIds = [...new Set(page.map((i) => i.assetId))];
  const [assignments, projects] = await Promise.all([
    prisma.assetAssignment.findMany({
      where: { assetId: { in: assetIds } },
      select: { assetId: true, projectId: true, startDate: true, endDate: true },
    }),
    prisma.project.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const idx = indexAssignments(assignments);
  const projById = new Map(projects.map((p) => [p.id, p]));

  const rows: FuelReportRow[] = [];
  for (const i of page) {
    const pid = assignedSiteOn(idx, i.assetId, i.issueDate) ?? i.asset.projectId;
    const proj = pid ? projById.get(pid) : null;

    // Exact attribution filter: a vehicle may have moved between sites during
    // the range, so only the issues that actually fall on the chosen site count.
    if (siteId && pid !== siteId) continue;

    rows.push({
      id: i.id,
      issueDate: i.issueDate,
      assetCode: i.asset.code,
      assetRegNo: i.asset.regNo,
      siteName: proj?.name ?? i.asset.project?.name ?? null,
      siteCode: proj?.code ?? i.asset.project?.code ?? null,
      fuelKind: i.fuelKind,
      litres: i.litres,
      pricePerLitreCents: i.pricePerLitre,
      totalCostCents: i.totalCost,
      meterReading: i.meterReading,
      readingType: i.readingType,
      issuedByName: i.issuedBy.name,
      source: i.source,
      voided: i.voided,
    });
  }

  let litres = 0;
  let costCents = 0;
  for (const r of rows) {
    if (r.voided) continue;
    litres += r.litres;
    costCents += r.totalCostCents;
  }

  return {
    rows,
    totals: {
      litres,
      costCents,
      issueCount: rows.filter((r) => !r.voided).length,
      vehicleCount: new Set(rows.map((r) => r.assetCode)).size,
    },
    truncated,
  };
}

/** Parses YYYY-MM-DD range params, defaulting to the current calendar month. */
export function parseRange(fromStr?: string | null, toStr?: string | null): { from: Date; to: Date } {
  const now = new Date();
  const from = fromStr
    ? new Date(`${fromStr}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = toStr
    ? new Date(`${toStr}T23:59:59.999`)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    from: isNaN(from.getTime()) ? new Date(now.getFullYear(), now.getMonth(), 1) : from,
    to: isNaN(to.getTime()) ? now : to,
  };
}

export function ymd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}
