import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getAgingReport } from "@/lib/billing/aging";
import { ArrowLeft, Wallet } from "lucide-react";

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function AgingPage() {
  const session = await getSession();
  if (!session) return null;

  const projectId = session.role === "USER" ? session.projectId ?? undefined : undefined;
  const report = await getAgingReport({ projectId });

  return (
    <div className="space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> Back to Billing
      </Link>

      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Wallet className="w-5 h-5 text-emerald-400" /> Receivables Aging
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Outstanding issued/overdue invoices (net of issued credit notes), bucketed by days past due. As of {report.asOf.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Kpi label="Current" value={rs(report.totals.current)} className="text-emerald-400" />
        <Kpi label="1–30 days" value={rs(report.totals.d1_30)} className="text-amber-400" />
        <Kpi label="31–60 days" value={rs(report.totals.d31_60)} className="text-orange-400" />
        <Kpi label="60+ days" value={rs(report.totals.d60plus)} className="text-red-400" />
        <Kpi label="Total outstanding" value={rs(report.totals.totalOutstanding)} className="text-white" />
      </div>

      {/* Per-site table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">By Site</h3>
        {report.sites.length === 0 ? (
          <div className="text-center py-10 text-xs text-emerald-400">No outstanding receivables. ✓</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Site</th>
                <th className="py-2.5 text-right">Invoices</th>
                <th className="py-2.5 text-right">Current</th>
                <th className="py-2.5 text-right">1–30</th>
                <th className="py-2.5 text-right">31–60</th>
                <th className="py-2.5 text-right">60+</th>
                <th className="py-2.5 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {report.sites.map((s) => (
                <tr key={s.projectId} className="hover:bg-white/[0.01]">
                  <td className="py-3 font-bold text-white">{s.name}</td>
                  <td className="py-3 text-right text-gray-400">{s.count}</td>
                  <td className="py-3 text-right text-gray-300">{rs(s.current)}</td>
                  <td className="py-3 text-right text-amber-400">{rs(s.d1_30)}</td>
                  <td className="py-3 text-right text-orange-400">{rs(s.d31_60)}</td>
                  <td className="py-3 text-right text-red-400">{rs(s.d60plus)}</td>
                  <td className="py-3 text-right font-bold text-white">{rs(s.totalOutstanding)}</td>
                </tr>
              ))}
              <tr className="border-t border-white/10 font-bold">
                <td className="py-3 text-white">GRAND TOTAL</td>
                <td className="py-3 text-right text-gray-300">{report.totals.count}</td>
                <td className="py-3 text-right text-gray-300">{rs(report.totals.current)}</td>
                <td className="py-3 text-right text-amber-400">{rs(report.totals.d1_30)}</td>
                <td className="py-3 text-right text-orange-400">{rs(report.totals.d31_60)}</td>
                <td className="py-3 text-right text-red-400">{rs(report.totals.d60plus)}</td>
                <td className="py-3 text-right text-white">{rs(report.totals.totalOutstanding)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 shadow-md">
      <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">{label}</span>
      <span className={`text-sm font-bold block mt-1 ${className}`}>{value}</span>
    </div>
  );
}
