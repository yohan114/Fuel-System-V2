import { prisma } from "../db";
import { indexAssignments, assignedSiteOn } from "../fuel/site-attribution";
import { colomboDayKey } from "../colombo-date";
import type { FuelViewScope } from "../fuel/view-scope";

// One row per refuel, for a date range and optionally one site, one vehicle or
// one product.
//
// The site column follows the vehicle's POSTING on the day, not the pump it was
// drawn from — a Marawila tipper that fills at the workshop is still Marawila's
// fuel and Marawila's cost. That is the same rule the issue log and the monthly
// bill use, so a site's total here reconciles with what it is charged.
//
// The pump is carried alongside, because "whose fuel is this" and "which tank
// did it leave" are both real questions and answering only one of them is what
// sends people back to the spreadsheets.
//
// Shared by the screen, the PDF and the Excel export so all three agree; a
// report that disagrees with its own download is worse than no report.

export interface FuelIssueReportFilter {
  from: Date;
  to: Date;
  projectId?: string;   // the vehicle's allocated site
  vehicle?: string;     // fleet code or registration, partial
  fuelKind?: string;
  // The site that owns the PUMP the fuel left, which is a different question
  // from projectId above and the one a pump operator is entitled to ask: their
  // own tank's book, including the visiting machines they fuelled.
  pumpProjectId?: string;
  // Resolve to nothing at all. Used where a login has no fuel scope, so the
  // report fails closed instead of falling through to the whole company.
  none?: boolean;
}

export interface FuelIssueReportRow {
  id: string;
  day: string;              // Colombo calendar day, YYYY-MM-DD
  assetCode: string;
  assetRegNo: string | null;
  siteCode: string | null;
  siteName: string | null;
  fuelKind: string;
  litres: number;
  costCents: number;
  meterReading: number | null;
  readingType: string | null;
  issuedBy: string;
  source: string;
  pumpName: string | null;
  pumpSiteName: string | null;
}

export interface FuelIssueReport {
  rows: FuelIssueReportRow[];
  totals: { litres: number; costCents: number; issues: number; vehicles: number };
  perSite: { code: string; name: string; litres: number; costCents: number; issues: number }[];
  truncated: boolean;
}

/**
 * The reader's scope as filter fields, so the screen, the PDF and the Excel are
 * scoped by one rule instead of three copies of it. The screen may pass the site
 * the reader picked; it is honoured only for a reader entitled to all of them.
 */
export function reportFilterForScope(
  scope: FuelViewScope,
  requestedSiteId?: string,
): Pick<FuelIssueReportFilter, "projectId" | "pumpProjectId" | "none"> {
  switch (scope.kind) {
    case "all":
      return { projectId: requestedSiteId || undefined };
    case "pump":
      return { pumpProjectId: scope.projectId };
    case "allocation":
      return { projectId: scope.projectId };
    case "none":
      return { none: true };
  }
}

// A range this size is a year of one busy site, or a month of the whole fleet.
// Past it the page stops being readable and the browser starts to struggle, so
// it is capped and says so rather than quietly showing part of the answer.
const ROW_CAP = 5000;

export async function buildFuelIssueReport(f: FuelIssueReportFilter): Promise<FuelIssueReport> {
  const where: Record<string, unknown> = {
    voided: false,
    issueDate: { gte: f.from, lte: f.to },
  };
  if (f.none) where.id = { in: [] };
  if (f.pumpProjectId) where.bulkTank = { projectId: f.pumpProjectId };
  if (f.fuelKind) where.fuelKind = f.fuelKind;
  if (f.vehicle) {
    const v = f.vehicle.trim();
    where.asset = { OR: [{ code: { contains: v } }, { regNo: { contains: v } }] };
  }

  const issues = await prisma.fuelIssue.findMany({
    where,
    omit: { photoData: true },
    include: {
      asset: { select: { id: true, code: true, regNo: true, projectId: true } },
      issuedBy: { select: { name: true } },
      bulkTank: { select: { name: true, project: { select: { name: true } } } },
    },
    orderBy: { issueDate: "desc" },
    take: ROW_CAP + 1,
  });
  const truncated = issues.length > ROW_CAP;
  const capped = truncated ? issues.slice(0, ROW_CAP) : issues;

  // Resolve each issue's site the same way the log does: the posting covering
  // the issue date, falling back to the vehicle's current pin.
  const assignments = await prisma.assetAssignment.findMany({
    where: { assetId: { in: [...new Set(capped.map((i) => i.assetId))] } },
    select: { assetId: true, projectId: true, startDate: true, endDate: true },
  });
  const idx = indexAssignments(assignments);
  const projects = await prisma.project.findMany({ select: { id: true, code: true, name: true } });
  const projById = new Map(projects.map((p) => [p.id, p]));

  const rows: FuelIssueReportRow[] = [];
  for (const i of capped) {
    const pid = assignedSiteOn(idx, i.assetId, i.issueDate) ?? i.asset.projectId;
    // The site filter applies AFTER attribution, because the question is "what
    // did this site burn", not "what came out of its tank".
    if (f.projectId && pid !== f.projectId) continue;
    const site = pid ? projById.get(pid) ?? null : null;
    rows.push({
      id: i.id,
      day: colomboDayKey(i.issueDate),
      assetCode: i.asset.code,
      assetRegNo: i.asset.regNo,
      siteCode: site?.code ?? null,
      siteName: site?.name ?? null,
      fuelKind: i.fuelKind,
      litres: i.litres,
      costCents: i.totalCost,
      meterReading: i.meterReading,
      readingType: i.readingType,
      issuedBy: i.issuedBy?.name ?? i.issuePerson ?? "—",
      source: i.source,
      pumpName: i.bulkTank?.name ?? null,
      pumpSiteName: i.bulkTank?.project?.name ?? null,
    });
  }

  const perSiteMap = new Map<string, { code: string; name: string; litres: number; costCents: number; issues: number }>();
  for (const r of rows) {
    const key = r.siteCode ?? "—";
    const e = perSiteMap.get(key) ?? { code: key, name: r.siteName ?? "Unassigned", litres: 0, costCents: 0, issues: 0 };
    e.litres += r.litres; e.costCents += r.costCents; e.issues++;
    perSiteMap.set(key, e);
  }

  return {
    rows,
    totals: {
      litres: rows.reduce((s, r) => s + r.litres, 0),
      costCents: rows.reduce((s, r) => s + r.costCents, 0),
      issues: rows.length,
      vehicles: new Set(rows.map((r) => r.assetCode)).size,
    },
    perSite: [...perSiteMap.values()].sort((a, b) => b.litres - a.litres),
    truncated,
  };
}

// The screen, the PDF and the Excel all read their filters from the same query
// string, so a download always matches what was on screen when it was clicked.
export function parseReportParams(get: (k: string) => string | null | undefined) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthEndStr = `${monthEnd.getFullYear()}-${pad(monthEnd.getMonth() + 1)}-${pad(monthEnd.getDate())}`;

  const fromStr = get("from") || monthStart;
  const toStr = get("to") || monthEndStr;
  return {
    fromStr, toStr,
    // Colombo midnight to Colombo end-of-day, so a range means the days a
    // storekeeper would name and not a UTC window shifted five and a half hours.
    from: new Date(`${fromStr}T00:00:00+05:30`),
    to: new Date(`${toStr}T23:59:59.999+05:30`),
    site: get("site") || "",
    vehicle: get("vehicle") || "",
    fuelKind: get("fuelKind") || "",
  };
}
