import React from "react";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { formatVariancePct } from "@/lib/reports/recommended";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { 
  FileSpreadsheet, 
  FileText, 
  Calendar, 
  Coins, 
  Fuel, 
  BarChart4, 
  Gauge,
  Sparkles
} from "lucide-react";
import SiteConsumptionCharts from "./SiteConsumptionCharts";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function ReportsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;

  // Defaults to current calendar month
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

  const fromStr = searchParams.from || defaultFrom;
  const toStr = searchParams.to || defaultTo;

  const fromDate = new Date(`${fromStr}T00:00:00Z`);
  const toDate = new Date(`${toStr}T23:59:59Z`);

  // Run the aggregation service
  const data = await aggregateFuelData({
    from: fromDate,
    to: toDate,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">Reports & Exports</h1>
          <p className="text-xs text-gray-400 mt-1">
            Aggregate fleet costs, analyze category averages, and download certified audit sheets.
          </p>
        </div>

        {/* Export triggers */}
        <div className="flex items-center gap-2">
          <a
            href={`/api/reports/monthly/xlsx?year=${fromStr.slice(0, 4)}&month=${fromStr.slice(5, 7)}`}
            className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-indigo-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
            Monthly Site Report
          </a>
          <a
            href={`/api/reports/export/xlsx?from=${fromStr}&to=${toStr}`}
            className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-emerald-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Export Excel
          </a>
          <a
            href={`/api/reports/export/pdf?from=${fromStr}&to=${toStr}`}
            className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-red-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <FileText className="w-4 h-4 text-red-400" />
            Export PDF
          </a>
        </div>
      </div>

      {/* Report Parameters Form */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg">
        <form method="GET" action="/reports" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              From Date
            </label>
            <input
              type="date"
              name="from"
              defaultValue={fromStr}
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              To Date
            </label>
            <input
              type="date"
              name="to"
              defaultValue={toStr}
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl py-3 active:scale-95 transition-all shadow-md"
            >
              Generate Report
            </button>
          </div>
        </form>
      </div>

      {/* Aggregate KPI summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Total Cost</span>
            <span className="text-base font-bold text-white block mt-0.5">
              Rs. {(data.totalCostCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Volume Pumped</span>
            <span className="text-base font-bold text-white block mt-0.5">
              {data.totalLitres.toLocaleString("en-US", { maximumFractionDigits: 1 })} L
            </span>
          </div>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400">
            <BarChart4 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Dispatches</span>
            <span className="text-base font-bold text-white block mt-0.5">
              {data.issueCount} events
            </span>
          </div>
        </div>
      </div>

      {/* Site-wise Fuel consumption analysis graph section */}
      <SiteConsumptionCharts siteData={data.siteBreakdown} />

      {/* Grid: Category Breakdown (Left) & Top Consumers (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Category breakdown table */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl lg:col-span-1">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">
            Consumption by Category
          </h3>
          {data.categoryBreakdown.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-500">No issues in range.</div>
          ) : (
            <div className="space-y-4">
              {data.categoryBreakdown.map((cat, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="font-bold text-white block">{cat.name}</span>
                    <span className="text-[10px] text-gray-500 font-mono">Code: {cat.code}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-white block">Rs. {(cat.costCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}</span>
                    <span className="text-[10px] text-gray-500">({cat.litres.toFixed(0)} L)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top assets breakdown table */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl lg:col-span-2 overflow-x-auto">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">
            Top Asset Consumption Breakdown
          </h3>
          {data.assetBreakdown.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-500">No logs in date range.</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-gray-400 font-semibold border-b border-white/5 pb-2">
                  <th className="py-2.5">E&C Number</th>
                  <th className="py-2.5">Specs</th>
                  <th className="py-2.5">Litres</th>
                  <th className="py-2.5">Total Cost</th>
                  <th className="py-2.5">Actual Meter</th>
                  <th className="py-2.5">Recommended</th>
                  <th className="py-2.5">Variance</th>
                  <th className="py-2.5 text-right">Economy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.assetBreakdown.slice(0, 15).map((asset, idx) => {
                  const formattedEff = asset.efficiency !== null
                    ? asset.meterType === "KM"
                      ? `${asset.efficiency.toFixed(2)} km/L`
                      : `${asset.efficiency.toFixed(2)} L/hr`
                    : "—";

                  return (
                    <tr key={idx} className="hover:bg-white/[0.01]">
                      <td className="py-3">
                        <Link
                          href={`/fleet/${asset.code}`}
                          className="font-bold text-white hover:text-indigo-400 transition-colors"
                        >
                          {asset.code}
                        </Link>
                      </td>
                      <td className="py-3 text-gray-400">
                        {asset.brand || ""} {asset.typeLabel || ""}
                      </td>
                      <td className="py-3 font-semibold text-white">
                        {asset.litres.toFixed(1)} L
                      </td>
                      <td className="py-3 font-bold text-white">
                        Rs. {(asset.costCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-3 text-gray-400 font-mono">
                        {asset.runningDelta > 0 ? `${asset.runningDelta.toLocaleString()} ${asset.meterType}` : "—"}
                      </td>
                      <td className="py-3 text-gray-300 font-mono">
                        {asset.recommended != null
                          ? `${asset.recommended.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${asset.meterType}`
                          : "—"}
                      </td>
                      <td className="py-3 font-semibold">
                        {asset.variancePct != null ? (
                          <span
                            className={
                              asset.flag === "METER_LOW"
                                ? "text-red-400"
                                : asset.flag === "METER_HIGH"
                                ? "text-amber-400"
                                : "text-gray-400"
                            }
                            title={
                              asset.flag === "METER_LOW"
                                ? "Fuel implies more running than the meter shows — possible under-recorded meter"
                                : asset.flag === "METER_HIGH"
                                ? "Meter shows more than fuel implies"
                                : "Within tolerance"
                            }
                          >
                            {formatVariancePct(asset.variancePct)}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right font-bold text-emerald-400">
                        {formattedEff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
