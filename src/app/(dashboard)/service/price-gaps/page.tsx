import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { findPriceGaps } from "@/lib/service/price-gaps";
import { Tags, ArrowLeft, CheckCircle2 } from "lucide-react";
import PriceInput from "./PriceInput";

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function PriceGapsPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const { gaps, count, withSuggestion } = await findPriceGaps(12);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Tags className="w-5 h-5 text-amber-400" /> Price Gaps
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Filters used in service (last 12 months) with no price-book entry. The suggested price is the average paid — confirm to add it. New prices apply instantly across cross-reference and planning.
          </p>
        </div>
        <Link href="/service/order-planner" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" /> Demand
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Unpriced Filters</span>
          <span className="text-2xl font-bold text-amber-400 block mt-1">{count}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Have Suggested Price</span>
          <span className="text-2xl font-bold text-white block mt-1">{withSuggestion}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 hidden sm:block">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Need Manual Price</span>
          <span className="text-2xl font-bold text-white block mt-1">{count - withSuggestion}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {gaps.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            Every filter used in service is in the price book. Nothing to fill.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Demand/mo</th>
                <th className="py-2.5 text-right">Services</th>
                <th className="py-2.5 text-right">Vehicles</th>
                <th className="py-2.5 text-right">Suggested</th>
                <th className="py-2.5 text-right">Set price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {gaps.map((g) => (
                <tr key={g.key} className="hover:bg-white/[0.01]">
                  <td className="py-3">
                    <Link href={`/service/cross-reference?q=${encodeURIComponent(g.filterNo)}`} className="font-bold text-white hover:text-indigo-400 font-mono">{g.filterNo}</Link>
                  </td>
                  <td className="py-3 text-gray-400">{g.category}</td>
                  <td className="py-3 text-right text-gray-300">{g.monthlyQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td className="py-3 text-right text-gray-500">{g.serviceCount}</td>
                  <td className="py-3 text-right text-gray-500">{g.vehicleCount}</td>
                  <td className="py-3 text-right text-gray-400">{fmtRs(g.suggestedCents)}</td>
                  <td className="py-3 text-right"><PriceInput supplierCode={g.filterNo} description={g.category} suggested={g.suggestedCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Saving creates a price-book entry (Admin → Service Prices). Filters with no suggested price had no cost recorded at service time — enter one manually.</p>
      </div>
    </div>
  );
}
