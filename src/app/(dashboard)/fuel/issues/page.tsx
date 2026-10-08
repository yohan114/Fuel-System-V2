import type { Prisma } from "@prisma/client";
import React from "react";
import { FUEL_KINDS } from "@/lib/fuel-kinds";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fuelViewScope } from "@/lib/fuel/view-scope";
import Link from "next/link";
import { Search } from "lucide-react";
import { assetSearchClause } from "@/lib/fleet/asset-search";
import { getFuelIssuesPaginated } from "@/lib/fuel/query-issues";
import FuelIssuesTableClient from "./FuelIssuesTableClient";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    fuelKind?: string;
    site?: string;
    issuedBy?: string;
    source?: string;
    tank?: string;
    page?: string;
    limit?: string;
  }>;
}

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
    // to it), plus pumps located at the site; the exact per-issue attribution
    // check runs below once each issue's site resolves.
    const [spans, pinned, siteTanks] = await Promise.all([
      prisma.assetAssignment.findMany({ where: { projectId: effectiveSite }, select: { assetId: true }, distinct: ["assetId"] }),
      prisma.asset.findMany({ where: { projectId: effectiveSite }, select: { id: true } }),
      prisma.bulkTank.findMany({ where: { projectId: effectiveSite }, select: { id: true } }),
    ]);
    const candidateAssetIds = [...new Set<string>([...spans.map((s) => s.assetId), ...pinned.map((a) => a.id)])];
    const tankIds = siteTanks.map((t) => t.id);
    if (tankIds.length > 0) {
      scopeWhere = {
        OR: [
          { assetId: { in: candidateAssetIds } },
          { bulkTankId: { in: tankIds } },
        ],
      };
    } else {
      scopeWhere = { assetId: { in: candidateAssetIds } };
    }
  }
  Object.assign(where, scopeWhere);

  // 2. Query dispatches via Phase 1/2 optimized pagination and narrow projection
  const [paginatedResult, summaryAggregate, selectedTank, issuerRows, sourceRows, projects] =
    await Promise.all([
      getFuelIssuesPaginated({
        where,
        page: searchParams.page,
        limit: searchParams.limit,
      }),
      prisma.fuelIssue.aggregate({
        where: { ...where, voided: false },
        _sum: { litres: true, totalCost: true },
      }),
      tankFilter && (scope.kind === "all" || pumpSite)
        ? prisma.bulkTank.findFirst({
            where: { id: tankFilter, ...(pumpSite ? { projectId: pumpSite } : {}) },
            select: {
              name: true,
              balance: true,
              capacity: true,
              project: { select: { name: true, code: true } },
            },
          })
        : Promise.resolve(null),
      isPrivileged
        ? prisma.fuelIssue.findMany({
            where: scopeWhere,
            select: { issuedById: true, issuedBy: { select: { name: true } } },
            distinct: ["issuedById"],
            orderBy: { issuedBy: { name: "asc" } },
          })
        : Promise.resolve([]),
      isPrivileged
        ? prisma.fuelIssue.findMany({
            select: { source: true },
            distinct: ["source"],
            orderBy: { source: "asc" },
          })
        : Promise.resolve([]),
      isPrivileged
        ? prisma.project.findMany({
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

  const totalLitres = summaryAggregate._sum.litres || 0;
  const totalCostCents = summaryAggregate._sum.totalCost || 0;
  const isAdmin = session.role === "ADMIN";
  const canCorrect = isPrivileged || session.role === "WORKSHOP" || session.role === "SITE_PUMP";

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
            {paginatedResult.data.length.toLocaleString()} issue{paginatedResult.data.length === 1 ? "" : "s"} shown
            {paginatedResult.pagination.totalCount > paginatedResult.data.length && (
              <> of {paginatedResult.pagination.totalCount.toLocaleString()} matching — use pagination to navigate</>
            )}
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

      {/* Phase 3: Virtualized & Paginated Dispatches Table */}
      <FuelIssuesTableClient
        data={paginatedResult.data}
        pagination={paginatedResult.pagination}
        isAdmin={isAdmin}
        canCorrect={canCorrect}
      />
    </div>
  );
}
