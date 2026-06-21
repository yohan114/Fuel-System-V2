import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { filterDemand } from "@/lib/service/demand";
import { Package, ArrowLeft } from "lucide-react";

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

// Suggests what filters to stock, from REAL service history over the last 12
// months priced at what was actually paid. Covers every filter actually fitted.
export default async function OrderPlannerPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const { rows: allRows, totalMonthlyCents, months, since } = await filterDemand(12);
  const rows = allRows.slice(0, 200);
  const pricedCount = rows.filter((r) => r.avgUnitCents != null).length;
  const sinceLabel = since.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-400" /> Filter Order Planner
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            What to stock — from actual filter usage since {sinceLabel} ({months} months), priced at what was paid. Estimates only; verify before ordering.
          </p>
        </div>
        <Link href="/service/cross-reference" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" /> Cross-Reference
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Est. Monthly Spend</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(totalMonthlyCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Annualized</span>
          <span className="text-2xl font-bold text-white block mt-1">{fmtRs(totalMonthlyCents * 12)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Distinct Filters</span>
          <span className="text-2xl font-bold text-white block mt-1">{allRows.length}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">With Price</span>
          <span className="text-2xl font-bold text-white block mt-1">{pricedCount}/{rows.length}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No filter usage recorded in the last {months} months.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Per month</th>
                <th className="py-2.5 text-right">Avg unit</th>
                <th className="py-2.5 text-right">Est. monthly cost</th>
                <th className="py-2.5 text-right">Services</th>
                <th className="py-2.5 text-right">Vehicles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-white/[0.01]">
                  <td className="py-3">
                    {r.filterNo ? (
                      <Link href={`/service/cross-reference?q=${encodeURIComponent(r.filterNo)}`} className="font-bold text-white hover:text-indigo-400 font-mono">{r.filterNo}</Link>
                    ) : (
                      <span className="text-gray-500 italic">No part no.</span>
                    )}
                  </td>
                  <td className="py-3 text-gray-400">{r.category}</td>
                  <td className="py-3 text-right text-white font-semibold">{r.monthlyQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td className="py-3 text-right text-gray-400">{fmtRs(r.avgUnitCents)}</td>
                  <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(r.monthlyCostCents)}</td>
                  <td className="py-3 text-right text-gray-500">{r.serviceCount}</td>
                  <td className="py-3 text-right text-gray-500">{r.vehicleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Demand and average unit price come from real service lines. Showing top {rows.length} of {allRows.length} filters by monthly spend.</p>
      </div>
    </div>
  );
}
