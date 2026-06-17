import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import Link from "next/link";
import { Search, Gauge, Calendar, User, CornerDownRight } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ReadingsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;
  const q = searchParams.q || "";

  // 1. Build where query
  const where: any = {};
  if (q) {
    where.asset = {
      code: { contains: q.trim().toUpperCase() },
    };
  }

  // Project-scoped users see readings only for vehicles currently assigned to
  // their site (plus any legacy-pinned, never-assigned vehicles).
  const visible = await visibleAssetIdsForUser(session);
  if (visible) {
    where.assetId = { in: [...visible] };
  }

  // 2. Query readings
  const readings = await prisma.meterReading.findMany({
    where,
    include: {
      asset: true,
      recordedBy: true,
    },
    orderBy: {
      readingDate: "desc",
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">Meter Readings Log</h1>
        <p className="text-xs text-gray-400 mt-1">
          Odometer mileage and engine hours log records, representing cumulative usage audits over time.
        </p>
      </div>

      {/* Filter and Summary Panel */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex items-center">
        <form method="GET" action="/readings" className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Search by asset */}
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search asset e.g. DT-01, HEX-11..."
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder-gray-500 text-xs focus:outline-none"
            />
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
              href="/readings"
              className="px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center border border-white/5 active:scale-95 transition-all"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {/* Readings list */}
      {readings.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-16 text-center text-xs text-gray-500">
          No meter readings found matching search criteria.
        </div>
      ) : (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          {/* Table */}
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Asset Code</th>
                <th className="px-6 py-4 font-semibold">Meter Type</th>
                <th className="px-6 py-4 font-semibold">Reading Value</th>
                <th className="px-6 py-4 font-semibold">Source</th>
                <th className="px-6 py-4 font-semibold">Logged By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {readings.map((reading) => (
                <tr key={reading.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4 text-gray-300 font-medium whitespace-nowrap">
                    {new Date(reading.readingDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/fleet/${reading.asset.code}`}
                      className="font-bold text-white hover:text-indigo-400 tracking-wide transition-colors"
                    >
                      {reading.asset.code}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Gauge className="w-3.5 h-3.5 text-gray-500" />
                      {reading.readingType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-white font-bold font-mono text-sm whitespace-nowrap">
                    {reading.value.toLocaleString()} {reading.readingType}
                  </td>
                  <td className="px-6 py-4 capitalize">
                    <span className="bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400 border border-white/5">
                      {reading.source.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    {reading.recordedBy.name}
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
