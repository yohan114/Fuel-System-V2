import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { aggregateServiceData } from "@/lib/reports/service-report";
import { BarChart3, ArrowLeft, FileSpreadsheet, FileText } from "lucide-react";
import ServiceCostCharts from "./ServiceCostCharts";

interface PageProps {
  searchParams: Promise<{ months?: string }>;
}

function fmtRs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function ServiceAnalyticsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const sp = await props.searchParams;
  const months = [6, 12, 18, 24].includes(Number(sp.months)) ? Number(sp.months) : 12;

  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const data = await aggregateServiceData({ from, to });
  const avgPerService = data.recordCount > 0 ? Math.round(data.totalCents / data.recordCount) : 0;

  const ranges = [6, 12, 18, 24];

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" /> Service Trends
          </h1>
          <p className="text-xs text-gray-400 mt-1">Service spend over the last {months} months.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-[#121420] border border-white/5 rounded-lg p-1">
            {ranges.map((m) => (
              <Link
                key={m}
                href={`/service/analytics?months=${m}`}
                className={`text-xs font-semibold rounded-md px-2.5 py-1 ${m === months ? "bg-indigo-500/20 text-indigo-300" : "text-gray-400 hover:text-white"}`}
              >
                {m}mo
              </Link>
            ))}
          </div>
          <a href={`/api/reports/service/xlsx?from=${fromStr}&to=${toStr}`} className="flex items-center gap-1.5 bg-[#121420] border border-white/5 hover:border-emerald-500/20 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Excel
          </a>
          <a href={`/api/reports/service/pdf?from=${fromStr}&to=${toStr}`} className="flex items-center gap-1.5 bg-[#121420] border border-white/5 hover:border-red-500/20 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold">
            <FileText className="w-4 h-4 text-red-400" /> PDF
          </a>
          <Link href="/service" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
            <ArrowLeft className="w-4 h-4" /> Planner
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Total Spend</span>
          <span className="text-2xl font-bold text-white block mt-1">{fmtRs(data.totalCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Services</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.recordCount.toLocaleString()}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Vehicles</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.vehicleCount.toLocaleString()}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Avg / Service</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(avgPerService)}</span>
        </div>
      </div>

      <ServiceCostCharts byMonth={data.byMonth} byCategory={data.byCategory} />

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Spend by Service Type</h3>
        {data.byType.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">No data.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.byType.map((t) => (
              <div key={t.type} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-xl px-4 py-3">
                <div>
                  <span className="text-xs font-semibold text-gray-200">{t.type}</span>
                  <p className="text-[10px] text-gray-500">{t.count} services</p>
                </div>
                <span className="text-sm font-bold text-white">{fmtRs(t.cents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
