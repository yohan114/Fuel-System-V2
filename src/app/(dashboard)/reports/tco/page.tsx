import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { aggregateTCO } from "@/lib/reports/tco";
import { ArrowLeft, Coins, Fuel, Wrench, Truck, Droplets } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

function fmtRs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

// Total cost of ownership per vehicle = fuel spend + service spend over a window.
export default async function TCOPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const sp = await props.searchParams;
  const now = new Date();
  // Default to a trailing 12-month window — TCO is most meaningful over a year.
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().split("T")[0];
  const fromStr = sp.from || defaultFrom;
  const toStr = sp.to || defaultTo;
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T23:59:59Z`);

  const isScoped = session.role === "USER" && !!session.projectId;
  const data = await aggregateTCO({ from, to, projectId: isScoped ? session.projectId! : undefined });

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-400" /> Cost of Ownership
          </h1>
          <p className="text-xs text-gray-400 mt-1">Fuel + service + oil spend per vehicle. {fromStr} → {toStr}.</p>
        </div>
        <div className="flex items-center gap-3">
          <form className="flex items-end gap-2" method="GET">
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">From</label>
              <input type="date" name="from" defaultValue={fromStr} className="bg-[#121420] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">To</label>
              <input type="date" name="to" defaultValue={toStr} className="bg-[#121420] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <button type="submit" className="bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 rounded-lg px-3 py-1.5 text-xs font-semibold">Apply</button>
          </form>
          <Link href="/reports" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
            <ArrowLeft className="w-4 h-4" /> Reports
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Total Spend</span>
          <span className="text-2xl font-bold text-white block mt-1">{fmtRs(data.totalCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5 text-blue-400" /> Fuel</span>
          <span className="text-2xl font-bold text-blue-400 block mt-1">{fmtRs(data.totalFuelCents)}</span>
          <span className="text-[10px] text-gray-500">{data.totalCents > 0 ? Math.round((data.totalFuelCents / data.totalCents) * 100) : 0}% of total</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-amber-400" /> Service</span>
          <span className="text-2xl font-bold text-amber-400 block mt-1">{fmtRs(data.totalServiceCents)}</span>
          <span className="text-[10px] text-gray-500">{data.totalCents > 0 ? Math.round((data.totalServiceCents / data.totalCents) * 100) : 0}% of total</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5 text-emerald-400" /> Oil</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(data.totalOilCents)}</span>
          <span className="text-[10px] text-gray-500">{data.totalCents > 0 ? Math.round((data.totalOilCents / data.totalCents) * 100) : 0}% of total</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Vehicles</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.vehicleCount}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {data.rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No fuel, service or oil spend in this period.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5 text-right">Fuel</th>
                <th className="py-2.5 text-right">Service</th>
                <th className="py-2.5 text-right">Oil</th>
                <th className="py-2.5 text-right">Total</th>
                <th className="py-2.5 w-28">Split</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.rows.map((r) => {
                const total = r.totalCents || 1;
                const fuelPct = (r.fuelCents / total) * 100;
                const svcPct = (r.serviceCents / total) * 100;
                const oilPct = (r.oilCents / total) * 100;
                return (
                  <tr key={r.assetId} className="hover:bg-white/[0.01]">
                    <td className="py-3">
                      <Link href={`/fleet/${r.code}`} className="font-bold text-white hover:text-indigo-400">{r.code}</Link>
                      {r.label ? <span className="block text-[10px] text-gray-500 truncate max-w-[160px]">{r.label}</span> : null}
                    </td>
                    <td className="py-3 text-gray-400">{r.categoryName}</td>
                    <td className="py-3 text-gray-400">{r.projectCode || "—"}</td>
                    <td className="py-3 text-right text-blue-400">{r.fuelCents ? fmtRs(r.fuelCents) : "—"}</td>
                    <td className="py-3 text-right text-amber-400">{r.serviceCents ? fmtRs(r.serviceCents) : "—"}</td>
                    <td className="py-3 text-right text-emerald-400">{r.oilCents ? fmtRs(r.oilCents) : "—"}</td>
                    <td className="py-3 text-right text-white font-bold">{fmtRs(r.totalCents)}</td>
                    <td className="py-3">
                      <div className="flex h-2 rounded-full overflow-hidden bg-white/5" title={`${Math.round(fuelPct)}% fuel · ${Math.round(svcPct)}% service · ${Math.round(oilPct)}% oil`}>
                        <div className="bg-blue-500/70" style={{ width: `${fuelPct}%` }} />
                        <div className="bg-amber-500/70" style={{ width: `${svcPct}%` }} />
                        <div className="bg-emerald-500/70" style={{ width: `${oilPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3"><span className="inline-block w-2 h-2 rounded-full bg-blue-500/70 mr-1" />Fuel <span className="inline-block w-2 h-2 rounded-full bg-amber-500/70 ml-3 mr-1" />Service <span className="inline-block w-2 h-2 rounded-full bg-emerald-500/70 ml-3 mr-1" />Oil · sorted by total spend.</p>
      </div>
    </div>
  );
}
