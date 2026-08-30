import type { Prisma } from "@prisma/client";
import React from "react";
import { FUEL_KINDS } from "@/lib/fuel-kinds";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { indexAssignments, assignedSiteOn } from "@/lib/fuel/site-attribution";
import { fuelDateTime } from "@/lib/colombo-date";
import { fuelViewScope } from "@/lib/fuel/view-scope";
import CorrectionButton from "./CorrectionButton";
import IssueAdminActions from "./IssueAdminActions";
import Link from "next/link";
import { Search, MapPin } from "lucide-react";
import { assetSearchClause } from "@/lib/fleet/asset-search";

interface PageProps {
  searchParams: Promise<{ q?: string; fuelKind?: string; site?: string; issuedBy?: string; source?: string; tank?: string }>;
}

const ISSUE_LIMIT = 1000;
// One pump's whole history is a deliberate request — "show me everything this
// tank ever issued" — and Marawila alone has over three thousand rows, so the
// general cap would silently hide most of it.
const PUMP_LIMIT = 20000;

export default async function FuelIssuesPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  // ADMIN and ALLOCATOR see the whole estate. Everyone who works a pump — the
  // site pumps and the workshop pump alike — sees only what came out of their
  // own tank. The workshop used to be privileged here on the reasoning that it
  // fuels vehicles from every site, but that let one operator read every site's
  // fuel book, and what a pump operator is accountable for is their own pump.
  const isPrivileged = session.role === "ADMIN" || session.role === "ALLOCATOR";

  const searchParams = await props.searchParams;
  const q = searchParams.q || "";
  const fuelKindFilter = searchParams.fuelKind || "";
  const siteFilter = searchParams.site || "";
  const issuedByFilter = searchParams.issuedBy || "";
  const sourceFilter = searchParams.source || "";
  const tankFilter = searchParams.tank || "";

  // 1. Build where query
  const where: Prisma.FuelIssueWhereInput = {};
  if (fuelKindFilter) where.fuelKind = fuelKindFilter;
  if (issuedByFilter) where.issuedById = issuedByFilter;
  if (sourceFilter) where.source = sourceFilter;
  // Matches the E&C number, the registration/vehicle number and the make/model
  // — searching the number on the vehicle used to return nothing.
  const assetSearch = assetSearchClause(q);
  if (assetSearch) where.asset = assetSearch;
  // Which PUMP dispensed the fuel — a different question from which site the
  // vehicle was allocated to, and the one the pump overview asks. A vehicle
  // posted to Marawila can still be fuelled at the workshop, so filtering by the
  // vehicle's site would miss exactly the rows this view is opened to see.
  if (tankFilter) where.bulkTankId = tankFilter;

  // Who may read what — see src/lib/fuel/view-scope.ts. A pump operator gets
  // their own pump's book (scoped by tank), a site login without a pump gets the
  // fuel its site is charged for (scoped by the vehicle's posting), and anything
  // unresolvable gets nothing.
  const scope = await fuelViewScope(session);
  const pumpSite = scope.kind === "pump" ? scope.projectId : null;
  // A privileged user's site dropdown means the allocation question, which is
  // what the site filter has always meant for them.
  const allocSite = scope.kind === "allocation" ? scope.projectId : scope.kind === "all" ? siteFilter : "";
  const effectiveSite = pumpSite ?? allocSite;

  // How much the tank HOLDS is management's figure, and no operator needs it to
  // do their job. What is in it right now is a different matter: the workshop
  // operator is the one who calls for a delivery when the pump runs low, so they
  // keep the balance. A site pump records the delivery it was given and does not
  // carry the stock figure at all — the same rule the site console applies.
  const showStock = isPrivileged || session.role === "WORKSHOP";
  const showCapacity = isPrivileged;

  // Held separately so every query on this page — the log, its count and the
  // issuer dropdown — carries the same scope. A dropdown listing people the log
  // will never show is a leak in miniature.
  let scopeWhere: Prisma.FuelIssueWhereInput = {};
  if (scope.kind === "none") {
    scopeWhere = { id: { in: [] } };
  } else if (pumpSite) {
    scopeWhere = { bulkTank: { projectId: pumpSite } };
  } else if (effectiveSite) {
    // Restrict the query to assets ever posted to the site (or currently pinned
    // to it); the exact per-issue attribution check runs below once each issue's
    // site resolves.
    const spans = await prisma.assetAssignment.findMany({ where: { projectId: effectiveSite }, select: { assetId: true }, distinct: ["assetId"] });
    const pinned = await prisma.asset.findMany({ where: { projectId: effectiveSite }, select: { id: true } });
    scopeWhere = { assetId: { in: [...new Set<string>([...spans.map((s) => s.assetId), ...pinned.map((a) => a.id)])] } };
  }
  Object.assign(where, scopeWhere);

  // 2. Query dispatches (most-recent first, capped)
  let issues = await prisma.fuelIssue.findMany({
    where,
    omit: { photoData: true },
    include: { asset: { include: { project: true } }, issuedBy: true },
    orderBy: { issueDate: "desc" },
    // A site filter is applied in memory below, after attribution — so the cap
    // has to cover the site's whole candidate pool or older rows silently
    // vanish from the filtered list. Nine sites draw on more than a thousand
    // candidate issues (Wadakada 4,700), which made "show me this site's fuel"
    // quietly return only the recent part of it.
    take: tankFilter || effectiveSite ? PUMP_LIMIT : ISSUE_LIMIT,
  });

  // The true number behind the cap, so a truncated list says so rather than
  // looking like the whole story.
  // Counted from the query, so it only means "the whole matching set" while no
  // site filter is on — a site is resolved per issue in memory below, and the
  // exact figure for that case is set after filtering.
  let matchingTotal = await prisma.fuelIssue.count({ where });
  // ?tank= is scoped as well. The rows themselves already fail closed for another
  // site's pump — the tank clause ANDs with the operator's — but the header reads
  // the tank directly, so without this it would name a pump the operator has no
  // rows from and print its stock beside an empty list.
  const selectedTank =
    tankFilter && (scope.kind === "all" || pumpSite)
      ? await prisma.bulkTank.findFirst({
          where: { id: tankFilter, ...(pumpSite ? { projectId: pumpSite } : {}) },
          select: { name: true, balance: true, capacity: true, project: { select: { name: true, code: true } } },
        })
      : null;

  // 3. Resolve each issue's assigned site (assignment covering the issue date;
  // fall back to the vehicle's current project pointer).
  const assetIds = [...new Set(issues.map((i) => i.assetId))];
  const assignments = await prisma.assetAssignment.findMany({
    where: { assetId: { in: assetIds } },
    select: { assetId: true, projectId: true, startDate: true, endDate: true },
  });
  const idx = indexAssignments(assignments);
  const projects = await prisma.project.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  const projById = new Map(projects.map((p) => [p.id, p]));
  // Same cascade as the site-wise fuel report, so the two screens agree:
  // the posting on the day, then the site that owns the pump the fuel came out
  // of, then the vehicle's current site. Without the tank step 973 issues
  // (133,533 L) showed no site at all and could not be found by site filter,
  // even though the pump identifies every one of them.
  const tanks = await prisma.bulkTank.findMany({ select: { id: true, projectId: true } });
  const tankProject = new Map(tanks.map((t) => [t.id, t.projectId]));
  const siteOfIssue = (i: (typeof issues)[number]) => {
    const pid =
      assignedSiteOn(idx, i.assetId, i.issueDate) ??
      (i.bulkTankId ? tankProject.get(i.bulkTankId) ?? null : null) ??
      i.asset.projectId;
    return pid ? projById.get(pid) ?? (i.asset.project ? { id: pid, name: i.asset.project.name, code: i.asset.project.code } : null) : null;
  };

  // The allocated-site filter is for a privileged user who picked a site. It must
  // NOT run for a pump operator: siteOfIssue resolves a visiting machine to the
  // site it is posted to, so filtering on it would throw away the very rows the
  // operator dispensed — already scoped correctly in SQL by their tank.
  if (effectiveSite && !pumpSite) {
    issues = issues.filter((i) => siteOfIssue(i)?.id === effectiveSite);
    matchingTotal = issues.length; // the pre-attribution count would overstate it
  }

  // Dropdown option sources. The issuer list obeys the same scope as the log, so
  // an operator's filter cannot name people at other sites.
  const [issuerRows, sourceRows] = await Promise.all([
    prisma.fuelIssue.findMany({ where: scopeWhere, select: { issuedById: true, issuedBy: { select: { name: true } } }, distinct: ["issuedById"], orderBy: { issuedBy: { name: "asc" } } }),
    prisma.fuelIssue.findMany({ select: { source: true }, distinct: ["source"], orderBy: { source: "asc" } }),
  ]);



  // Mark issues that already have a pending correction request.
  const pendingCorr = await prisma.fuelIssueCorrection.findMany({
    where: { fuelIssueId: { in: issues.map((i) => i.id) }, status: "PENDING" },
    select: { fuelIssueId: true },
  });
  const pendingSet = new Set(pendingCorr.map((c) => c.fuelIssueId));

  // How many times each issue on screen has been touched, for the badge on the
  // history button. The trail itself is fetched only when someone opens it.
  //
  // Deliberately NOT `entityId: { in: [...the page's ids] }`. This page shows a
  // thousand rows, twenty thousand under a pump filter, and every id becomes a
  // bound parameter — past SQLite's limit, which is how this page came to
  // return a server error the moment the history lookup was added. Grouping the
  // whole FuelIssue slice of the audit log costs no parameters at all and scales
  // with how often anyone edits fuel, not with how much fuel there is.
  const isAdmin = session.role === "ADMIN";
  const historyCount = new Map<string, number>();
  const tankName = new Map<string, string>();
  if (isAdmin) {
    const [counts, tanks] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ["entityId"],
        where: { entity: "FuelIssue" },
        _count: { _all: true },
      }),
      prisma.bulkTank.findMany({ select: { id: true, name: true } }),
    ]);
    for (const c of counts) if (c.entityId) historyCount.set(c.entityId, c._count._all);
    for (const t of tanks) tankName.set(t.id, t.name);
  }

  // 3. Compute sums (voided issues don't count toward the filter totals)
  let totalLitres = 0;
  let totalCostCents = 0;
  issues.forEach((issue) => {
    if (issue.voided) return;
    totalLitres += issue.litres;
    totalCostCents += issue.totalCost;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">
          {selectedTank ? selectedTank.name : "Fuel Issues Log"}
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          {selectedTank
            ? <>Every fuel issue dispensed from this pump{selectedTank.project ? <> · {selectedTank.project.name} ({selectedTank.project.code})</> : null}
                {showStock && <> · stock {selectedTank.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })} L{showCapacity && <> of {selectedTank.capacity.toLocaleString()} L</>}</>}</>
            : "Historical record of fuel dispatches, cost snapshots, and linked request references."}
        </p>
        {selectedTank && (
          <p className="text-[11px] text-gray-500 mt-2">
            {issues.length.toLocaleString()} issue{issues.length === 1 ? "" : "s"} shown
            {matchingTotal > issues.length && <> of {matchingTotal.toLocaleString()} — narrow the filters to see the rest</>}
            {" · "}
            <a href="/fuel/issues" className="text-indigo-400 hover:text-indigo-300">clear pump filter</a>
            {" · "}
            <a href="/workshop" className="text-indigo-400 hover:text-indigo-300">back to pump overview</a>
          </p>
        )}
      </div>

      {/* Filter and Summary Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters Form */}
        <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex items-center">
          <form method="GET" action="/fuel/issues" className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
            {tankFilter && <input type="hidden" name="tank" value={tankFilter} />}
            {/* Search by vehicle */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="E&C or vehicle no. e.g. LB-23 / ZB-2587"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder-gray-500 text-xs focus:outline-none"
              />
            </div>

            {/* Fuel Kind dropdown */}
            <div>
              <select name="fuelKind" defaultValue={fuelKindFilter} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                <option value="">All Fuel Kinds</option>
                {FUEL_KINDS.map((k) => (
                  <option key={k.code} value={k.code}>{k.short}</option>
                ))}
              </select>
            </div>

            {/* Assigned Site dropdown — attributes each issue to the vehicle's posted site */}
            {isPrivileged && (
              <div>
                <select name="site" defaultValue={siteFilter} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                  <option value="">All Sites (assigned)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Issued By dropdown */}
            {isPrivileged && (
              <div>
                <select name="issuedBy" defaultValue={issuedByFilter} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                  <option value="">All Issuers</option>
                  {issuerRows.map((r) => (
                    <option key={r.issuedById} value={r.issuedById}>{r.issuedBy.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Source (pump/station) dropdown */}
            {isPrivileged && (
              <div>
                <select name="source" defaultValue={sourceFilter} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                  <option value="">All Sources</option>
                  {sourceRows.map((r) => (
                    <option key={r.source} value={r.source}>{r.source}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl py-2.5 active:scale-95 transition-all shadow-md"
              >
                Filter Log
              </button>
              <Link
                href="/fuel/issues"
                className="px-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center border border-white/5 active:scale-95 transition-all"
              >
                Clear
              </Link>
            </div>
          </form>
        </div>

        {/* Aggregated totals info */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex items-center justify-between text-xs">
          <div>
            <span className="text-gray-400 font-semibold block uppercase tracking-wider text-[10px]">Filter Sum</span>
            <span className="text-white block mt-1 font-bold text-base">
              {totalLitres.toLocaleString("en-US", { maximumFractionDigits: 1 })} L
            </span>
            <span className="text-[10px] text-gray-500 block">Total volume matching filters</span>
          </div>
          <div className="text-right">
            <span className="text-gray-400 font-semibold block uppercase tracking-wider text-[10px]">Total Cost</span>
            <span className="text-indigo-400 block mt-1 font-bold text-base">
              Rs. {(totalCostCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-gray-500 block">Total cost in LKR</span>
          </div>
        </div>
      </div>

      {/* Dispatches List */}
      {issues.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-16 text-center text-xs text-gray-500">
          No dispatches found matching filters.
        </div>
      ) : (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          {/* The outer box keeps the rounded corners; this inner div is the
              scroll container. The box used to be overflow-hidden around a
              w-full table, which is why ten columns crushed into each other on
              anything short of a very wide monitor — the site cell stacked into
              four lines and the Action column was clipped off the right edge
              with no way to reach it. A min-width plus a real scroll container
              lets the columns keep their size and gives you a bar to get to
              them. */}
          <div className="overflow-x-auto overflow-y-auto max-h-[68vh] fuel-log-scroll">
            <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
              {/* Fixed widths so the columns do not renegotiate their size on
                  every page of results — a table whose columns jump as you
                  scroll is far harder to read down. */}
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[130px]" />
                <col className="w-[200px]" />
                <col className="w-[95px]" />
                <col className="w-[85px]" />
                <col className="w-[95px]" />
                <col className="w-[130px]" />
                <col className="w-[140px]" />
                <col className="w-[130px]" />
                <col className="w-[125px]" />
              </colgroup>
            <thead>
              {/* Sticky, and opaque rather than bg-white/5 — a translucent
                  header lets the rows scroll visibly through it. */}
              <tr className="sticky top-0 z-10 bg-[#1b1e2e] text-gray-400 border-b border-white/10 shadow-sm">
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Date</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Asset Code</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Assigned Site</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Fuel Kind</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap text-right">Volume</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap text-right">Pump Price</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap text-right">Total Cost</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Issue Person</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap">Source</th>
                <th className="px-4 py-3.5 font-semibold whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {issues.map((issue) => (
                <tr key={issue.id} className={`hover:bg-white/[0.02] transition-colors ${issue.voided ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-gray-300 font-medium whitespace-nowrap">
                    {fuelDateTime(issue.issueDate)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/fleet/${issue.asset.code}`}
                      className={`font-bold tracking-wide transition-colors ${issue.voided ? "text-gray-500 line-through" : "text-white hover:text-indigo-400"}`}
                    >
                      {issue.asset.code}
                    </Link>
                    {issue.asset.regNo && (
                      <span className="block text-[10px] text-gray-400 font-medium mt-0.5">{issue.asset.regNo}</span>
                    )}
                    {issue.voided && (
                      <span className="ml-2 bg-red-500/10 text-red-300 border border-red-500/10 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase">Voided</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {(() => {
                      const s = siteOfIssue(issue);
                      const drawnElsewhere = s && issue.source && s.code && issue.source.toUpperCase() !== s.code.toUpperCase() && !issue.source.toUpperCase().includes(s.code.toUpperCase());
                      // Two lines, each truncated, rather than one inline-flex.
                      // "Badalgama Main Workshop Main pump" is long enough that
                      // the old single run wrapped into a four-line stack and
                      // set the height of every row on the page. The full text
                      // stays available on hover.
                      return s ? (
                        <div className="min-w-0">
                          <span className="flex items-center gap-1 text-gray-300 min-w-0" title={s.name}>
                            <MapPin className="w-3 h-3 text-indigo-400 shrink-0" />
                            <span className="truncate">{s.name}</span>
                          </span>
                          {drawnElsewhere && (
                            <span
                              title={`Fuel drawn at ${issue.source}`}
                              className="block truncate text-[9px] text-amber-400/70 mt-0.5 pl-4"
                            >
                              ↩ {issue.source}
                            </span>
                          )}
                        </div>
                      ) : <span className="text-gray-600">Unassigned</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-400 capitalize">
                    {issue.fuelKind.replace("_", " ").toLowerCase()}
                  </td>
                  {/* Figures right-aligned and tabular so the decimal points
                      line up down the column — 100.0 L above 20.0 L above
                      219.0 L is only scannable if the digits sit under each
                      other. */}
                  <td className="px-4 py-3 text-white font-bold whitespace-nowrap text-right tabular-nums">
                    {issue.litres.toFixed(1)} L
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-right tabular-nums">
                    Rs. {(issue.pricePerLitre / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-white font-bold whitespace-nowrap text-right tabular-nums">
                    Rs. {(issue.totalCost / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <span className="block truncate" title={issue.issuePerson || issue.issuedBy.name}>
                      {issue.issuePerson || issue.issuedBy.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {/* A one-line badge that truncates, not a block that wraps.
                        "BADALGAMA MAIN WORKSHOP MAIN PUMP" in a narrow column
                        broke across four lines and stretched the whole row. */}
                    <span
                      title={issue.source}
                      className="block max-w-full truncate bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400 border border-white/5"
                    >
                      {issue.source}
                    </span>
                    {issue.photoName && (
                      <a href={`/api/fuel-issues/${issue.id}/photo`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold underline">
                        photo
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* An admin acts directly and the act is recorded; everyone
                        else asks, and the request is reviewed. Same data, two
                        different responsibilities. */}
                    {isAdmin ? (
                      <IssueAdminActions
                        issue={{
                          id: issue.id,
                          assetCode: issue.asset.code,
                          litres: issue.litres,
                          fuelKind: issue.fuelKind,
                          meterReading: issue.meterReading,
                          source: issue.source,
                          issueDate: issue.issueDate.toISOString(),
                          voided: issue.voided,
                          bulkTankName: tankName.get(issue.bulkTankId ?? "") ?? null,
                          tankLocked: !!issue.bulkTankId,
                        }}
                        historyCount={historyCount.get(issue.id) ?? 0}
                      />
                    ) : issue.voided ? (
                      <span className="text-[10px] text-gray-600">—</span>
                    ) : pendingSet.has(issue.id) ? (
                      <span className="text-[10px] font-semibold text-amber-300/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2.5 py-1.5">
                        Correction pending
                      </span>
                    ) : (
                      <CorrectionButton
                        issue={{
                          id: issue.id,
                          assetCode: issue.asset.code,
                          litres: issue.litres,
                          meterReading: issue.meterReading,
                          readingType: issue.readingType,
                          fuelKind: issue.fuelKind,
                          issueDateISO: issue.issueDate.toISOString(),
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          {/* Says what you are looking at, and that the table scrolls — a
              scroll container with no edge cue reads as a short list. */}
          <div className="px-4 py-2.5 border-t border-white/5 text-[10px] text-gray-500 flex items-center justify-between gap-3">
            <span>
              Showing {issues.length.toLocaleString()}
              {matchingTotal > issues.length ? ` of ${matchingTotal.toLocaleString()}` : ""} issue
              {issues.length === 1 ? "" : "s"}
            </span>
            <span className="hidden sm:inline text-gray-600">Scroll inside the table — the header stays put</span>
          </div>
        </div>
      )}
    </div>
  );
}
