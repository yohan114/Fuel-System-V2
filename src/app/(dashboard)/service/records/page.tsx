import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ClipboardList, Search, Plus } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}

function fmtRs(cents: number | null | undefined) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function ServiceRecordsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  const isAdmin = session.role === "ADMIN";

  const sp = await props.searchParams;
  const q = (sp.q || "").trim();
  const from = (sp.from || "").trim();
  const to = (sp.to || "").trim();

  const where: Prisma.ServiceRecordWhereInput = {};
  // USERs only see services for vehicles on their own project/site.
  if (session.role === "USER" && session.projectId) {
    where.asset = { projectId: session.projectId };
  }
  if (q) {
    where.OR = [
      { asset: { code: { contains: q } } },
      { asset: { regNo: { contains: q } } },
      { jobNo: { contains: q } },
      { siteLocation: { contains: q } },
      { serviceType: { contains: q } },
    ];
  }
  const dateFilter: Prisma.DateTimeFilter = {};
  if (from && !isNaN(new Date(from).getTime())) dateFilter.gte = new Date(from);
  if (to && !isNaN(new Date(to).getTime())) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }
  if (dateFilter.gte || dateFilter.lte) where.serviceDate = dateFilter;

  const records = await prisma.serviceRecord.findMany({
    where,
    orderBy: { serviceDate: "desc" },
    take: 300,
    select: {
      id: true,
      serviceDate: true,
      jobNo: true,
      siteLocation: true,
      serviceType: true,
      meterAtService: true,
      meterType: true,
      grandTotalCents: true,
      costCents: true,
      asset: { select: { code: true, regNo: true, brand: true, model: true } },
      recordedBy: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-400" /> Service Records
          </h1>
          <p className="text-xs text-gray-400 mt-1">Full searchable service history across the fleet.</p>
        </div>
        {isAdmin && (
          <Link
            href="/service/new"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2.5 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New service
          </Link>
        )}
      </div>

      {/* Search */}
      <form className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <label className="sm:col-span-6 block">
          <span className="text-[10px] text-gray-500 uppercase block mb-1">Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Vehicle code, registration, job no, site, type…"
            className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-full focus:outline-none focus:border-indigo-500/40"
          />
        </label>
        <label className="sm:col-span-2 block">
          <span className="text-[10px] text-gray-500 uppercase block mb-1">From</span>
          <input type="date" name="from" defaultValue={from} className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-full" />
        </label>
        <label className="sm:col-span-2 block">
          <span className="text-[10px] text-gray-500 uppercase block mb-1">To</span>
          <input type="date" name="to" defaultValue={to} className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-full" />
        </label>
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2 flex items-center gap-1.5">
            <Search className="w-4 h-4" /> Search
          </button>
          {(q || from || to) && (
            <Link href="/service/records" className="text-xs font-semibold text-gray-400 hover:text-white px-2 py-2">Clear</Link>
          )}
        </div>
      </form>

      {/* Results */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">{records.length} record{records.length === 1 ? "" : "s"}{records.length === 300 ? " (showing latest 300)" : ""}</span>
        </div>
        {records.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No service records found.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Job no.</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5 text-right">Meter</th>
                <th className="py-2.5 text-right">Total</th>
                <th className="py-2.5">Logged by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 whitespace-nowrap">
                    <Link href={`/service/records/${r.id}`} className="text-gray-200 hover:text-indigo-400 font-medium">{fmtDate(r.serviceDate)}</Link>
                  </td>
                  <td className="py-3">
                    <Link href={`/service/records/${r.id}`} className="font-bold text-white hover:text-indigo-400">{r.asset.code}</Link>
                    <span className="block text-[10px] text-gray-500">{[r.asset.brand, r.asset.model].filter(Boolean).join(" ") || r.asset.regNo || ""}</span>
                  </td>
                  <td className="py-3 text-gray-400">{r.jobNo || "—"}</td>
                  <td className="py-3 text-gray-400">{r.siteLocation || "—"}</td>
                  <td className="py-3 text-gray-300">{r.serviceType || "—"}</td>
                  <td className="py-3 text-right text-gray-400 font-mono">{r.meterAtService != null ? `${r.meterAtService.toLocaleString()} ${r.meterType === "KM" ? "km" : "hr"}` : "—"}</td>
                  <td className="py-3 text-right text-white font-semibold">{fmtRs(r.grandTotalCents || r.costCents)}</td>
                  <td className="py-3 text-gray-400">{r.recordedBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
