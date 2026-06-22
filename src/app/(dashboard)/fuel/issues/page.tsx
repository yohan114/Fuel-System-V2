import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import CorrectionButton from "./CorrectionButton";
import Link from "next/link";
import { Search, Fuel, Coins, Calendar, User, CornerDownRight } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ q?: string; fuelKind?: string }>;
}

export default async function FuelIssuesPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;
  const q = searchParams.q || "";
  const fuelKindFilter = searchParams.fuelKind || "";

  // 1. Build where query
  const where: any = {};
  if (fuelKindFilter) {
    where.fuelKind = fuelKindFilter;
  }

  if (q) {
    where.asset = {
      code: { contains: q.trim().toUpperCase() },
    };
  }

  const visible = await visibleAssetIdsForUser(session);
  if (visible) {
    where.assetId = { in: [...visible] };
  }

  // 2. Query dispatches
  const issues = await prisma.fuelIssue.findMany({
    where,
    omit: { photoData: true },
    include: {
      asset: true,
      issuedBy: true,
    },
    orderBy: {
      issueDate: "desc",
    },
  });



  // Mark issues that already have a pending correction request.
  const pendingCorr = await prisma.fuelIssueCorrection.findMany({
    where: { fuelIssueId: { in: issues.map((i) => i.id) }, status: "PENDING" },
    select: { fuelIssueId: true },
  });
  const pendingSet = new Set(pendingCorr.map((c) => c.fuelIssueId));

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
        <h1 className="text-xl font-bold text-white tracking-wide">Fuel Issues Log</h1>
        <p className="text-xs text-gray-400 mt-1">
          Historical record of fuel dispatches, cost snapshots, and linked request references.
        </p>
      </div>

      {/* Filter and Summary Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters Form */}
        <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex items-center">
          <form method="GET" action="/fuel/issues" className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Search by asset */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Search asset e.g. DT-01"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder-gray-500 text-xs focus:outline-none"
              />
            </div>

            {/* Fuel Kind dropdown */}
            <div>
              <select
                name="fuelKind"
                defaultValue={fuelKindFilter}
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
              >
                <option value="">All Fuel Kinds</option>
                <option value="AUTO_DIESEL">Auto Diesel</option>
                <option value="SUPER_DIESEL">Super Diesel</option>
              </select>
            </div>

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
          {/* Table */}
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Asset Code</th>
                <th className="px-6 py-4 font-semibold">Fuel Kind</th>
                <th className="px-6 py-4 font-semibold">Volume</th>
                <th className="px-6 py-4 font-semibold">Pump Price</th>
                <th className="px-6 py-4 font-semibold">Total Cost</th>
                <th className="px-6 py-4 font-semibold">Issued By</th>
                <th className="px-6 py-4 font-semibold">Source</th>
                <th className="px-6 py-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {issues.map((issue) => (
                <tr key={issue.id} className={`hover:bg-white/[0.02] transition-colors ${issue.voided ? "opacity-50" : ""}`}>
                  <td className="px-6 py-4 text-gray-300 font-medium whitespace-nowrap">
                    {new Date(issue.issueDate).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/fleet/${issue.asset.code}`}
                      className={`font-bold tracking-wide transition-colors ${issue.voided ? "text-gray-500 line-through" : "text-white hover:text-indigo-400"}`}
                    >
                      {issue.asset.code}
                    </Link>
                    {issue.voided && (
                      <span className="ml-2 bg-red-500/10 text-red-300 border border-red-500/10 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase">Voided</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-400 capitalize">
                    {issue.fuelKind.replace("_", " ").toLowerCase()}
                  </td>
                  <td className="px-6 py-4 text-white font-bold whitespace-nowrap">
                    {issue.litres.toFixed(1)} L
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    Rs. {(issue.pricePerLitre / 100).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-white font-bold whitespace-nowrap">
                    Rs. {(issue.totalCost / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    {issue.issuedBy.name}
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400 border border-white/5">
                      {issue.source}
                    </span>
                    {issue.photoName && (
                      <a href={`/api/fuel-issues/${issue.id}/photo`} target="_blank" rel="noopener noreferrer" className="ml-2 text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold underline">
                        photo
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {issue.voided ? (
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
      )}
    </div>
  );
}
