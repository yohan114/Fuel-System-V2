import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ClipboardList, Search, Paperclip, Filter as FilterIcon, Wrench } from "lucide-react";
import { conditionLabel } from "@/lib/service/sheet";
import { getVehicleFilters } from "@/lib/service/filters";

interface PageProps {
  searchParams: Promise<{ vehicle?: string; site?: string; type?: string; from?: string; to?: string }>;
}

function rs(c: number | null | undefined) {
  return c == null ? "—" : "Rs " + (c / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}
function fmt(d: Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function ServiceLogPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role === "USER") redirect("/service");

  const sp = await props.searchParams;
  const vehicle = (sp.vehicle || "").trim();
  const site = (sp.site || "").trim();
  const type = (sp.type || "").trim();
  const from = (sp.from || "").trim();
  const to = (sp.to || "").trim();

  // Filter clause.
  const where: any = {};
  if (vehicle) where.asset = { code: { contains: vehicle.toUpperCase() } };
  if (site) where.location = site;
  if (type) where.serviceType = type;
  if (from || to) {
    where.serviceDate = {};
    if (from) where.serviceDate.gte = new Date(from + "T00:00:00Z");
    if (to) where.serviceDate.lte = new Date(to + "T23:59:59Z");
  }

  const [services, siteList, typeList, agg] = await Promise.all([
    prisma.serviceRecord.findMany({
      where,
      include: { asset: { select: { code: true, regNo: true, model: true, brand: true } }, _count: { select: { attachments: true, items: true } } },
      orderBy: { serviceDate: "desc" },
      take: 300,
    }),
    prisma.serviceRecord.findMany({ where: { location: { not: null } }, select: { location: true }, distinct: ["location"], orderBy: { location: "asc" } }),
    prisma.serviceRecord.findMany({ where: { serviceType: { not: null } }, select: { serviceType: true }, distinct: ["serviceType"], orderBy: { serviceType: "asc" } }),
    prisma.serviceRecord.aggregate({ where, _sum: { costCents: true }, _count: { _all: true } }),
  ]);

  // Recommended filters when the search is an exact vehicle code.
  const exactAsset = vehicle
    ? await prisma.asset.findFirst({ where: { code: vehicle.toUpperCase() }, select: { id: true, code: true, model: true, brand: true } })
    : null;
  const vehicleFilters = exactAsset ? await getVehicleFilters(exactAsset.id) : [];

  const input = "bg-[#1b1e30] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:border-cyan-500/50 outline-none";
  const label = "block text-[10px] uppercase tracking-wider text-gray-500 mb-1";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold text-white">Services</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/service" className="text-xs text-gray-400 hover:text-gray-200 bg-white/5 rounded-lg px-3 py-2">Planner</Link>
          {(session.role === "ADMIN" || session.role === "WORKSHOP") && (
            <Link href="/service/new" className="bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-xs rounded-lg px-3 py-2">New Service Sheet</Link>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <form method="GET" className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
        <div className="col-span-2">
          <label className={label}>Vehicle (E&C code)</label>
          <input name="vehicle" defaultValue={vehicle} placeholder="e.g. HEX-21" className={input + " w-full"} />
        </div>
        <div>
          <label className={label}>Site</label>
          <select name="site" defaultValue={site} className={input + " w-full"}>
            <option value="">All</option>
            {siteList.map((s) => <option key={s.location!} value={s.location!}>{s.location}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Type</label>
          <select name="type" defaultValue={type} className={input + " w-full"}>
            <option value="">All</option>
            {typeList.map((t) => <option key={t.serviceType!} value={t.serviceType!}>{t.serviceType}</option>)}
          </select>
        </div>
        <div><label className={label}>From</label><input type="date" name="from" defaultValue={from} className={input + " w-full"} /></div>
        <div className="flex gap-2">
          <div className="flex-1"><label className={label}>To</label><input type="date" name="to" defaultValue={to} className={input + " w-full"} /></div>
          <button type="submit" className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 self-end"><Search className="w-4 h-4" /></button>
        </div>
      </form>

      <div className="flex items-center gap-6 text-xs text-gray-400 px-1">
        <span><strong className="text-white">{agg._count._all.toLocaleString()}</strong> services</span>
        <span>Total value <strong className="text-cyan-300">{rs(agg._sum.costCents)}</strong></span>
        {(vehicle || site || type || from || to) && <Link href="/service/log" className="text-gray-500 hover:text-gray-300 underline">clear filters</Link>}
      </div>

      {/* Recommended filters for an exact vehicle */}
      {exactAsset && (
        <div className="bg-[#121420] border border-indigo-500/15 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FilterIcon className="w-4 h-4 text-indigo-400" /> Recommended filters — {exactAsset.code}
              <span className="text-gray-500 normal-case font-normal">{exactAsset.model || exactAsset.brand || ""}</span>
            </h3>
            <span className="text-[11px] text-gray-500">{vehicleFilters.length} filters on file · <Link href={`/filters?q=${encodeURIComponent(exactAsset.code)}`} className="text-indigo-400 hover:text-indigo-300">open in Filter DB →</Link></span>
          </div>
          {vehicleFilters.length === 0 ? (
            <p className="text-xs text-gray-600">No filter list on file for this vehicle yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b border-white/5">
                  <th className="px-3 py-2 font-semibold">Filter</th><th className="px-3 py-2 font-semibold">Part no.</th>
                  <th className="px-3 py-2 font-semibold">Equivalents</th><th className="px-3 py-2 font-semibold text-right">Price</th>
                  <th className="px-3 py-2 font-semibold text-right">Times fitted</th>
                </tr></thead>
                <tbody>
                  {vehicleFilters.map((f) => (
                    <tr key={f.filterId} className="border-b border-white/5">
                      <td className="px-3 py-2 text-gray-200">{f.category || "—"}</td>
                      <td className="px-3 py-2 font-mono text-white">{f.hifiPartNo || f.oemPartNo || "—"}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-[11px]">{f.crossRefs.length ? f.crossRefs.join(", ") : "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${f.priceCents != null ? "text-emerald-400" : "text-gray-600"}`}>{rs(f.priceCents)}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{f.timesUsed || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Services table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500 border-b border-white/5">
              <th className="px-3 py-2.5 font-semibold">Date</th><th className="px-3 py-2.5 font-semibold">Vehicle</th>
              <th className="px-3 py-2.5 font-semibold">Job No</th><th className="px-3 py-2.5 font-semibold">Meter</th>
              <th className="px-3 py-2.5 font-semibold">Type</th><th className="px-3 py-2.5 font-semibold">Site</th>
              <th className="px-3 py-2.5 font-semibold">Cond.</th><th className="px-3 py-2.5 font-semibold text-right">Parts</th>
              <th className="px-3 py-2.5 font-semibold text-right">Total</th><th className="px-3 py-2.5 font-semibold"></th>
            </tr></thead>
            <tbody>
              {services.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-600">No services match these filters.</td></tr>
              )}
              {services.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{fmt(s.serviceDate)}</td>
                  <td className="px-3 py-2"><Link href={`/fleet/${s.asset.code}`} className="text-cyan-400 hover:text-cyan-300 font-semibold">{s.asset.code}</Link> <span className="text-gray-600">{s.asset.model || s.asset.brand || ""}</span></td>
                  <td className="px-3 py-2 text-gray-400 font-mono">{s.jobNo || "—"}</td>
                  <td className="px-3 py-2 text-gray-400 font-mono">{s.meterAtService != null ? `${s.meterAtService.toLocaleString()} ${s.meterType}` : "—"}</td>
                  <td className="px-3 py-2 text-gray-400">{s.serviceType || "—"}</td>
                  <td className="px-3 py-2 text-gray-400">{s.location || "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{s.condition ? conditionLabel(s.condition) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{rs(s.partsCents)}</td>
                  <td className="px-3 py-2 text-right font-mono text-white font-semibold">{rs(s.costCents)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {s._count.attachments > 0 && <Paperclip className="w-3 h-3 inline text-cyan-400 mr-2" />}
                    <Link href={`/service/record/${s.id}`} className="text-indigo-400 hover:text-indigo-300">view</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {services.length === 300 && <p className="text-[11px] text-gray-600 text-center">Showing the most recent 300 — narrow the filters to see older services.</p>}
    </div>
  );
}
