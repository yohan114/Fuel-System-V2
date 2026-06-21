import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { computeReorder } from "@/lib/service/reorder";
import { ShoppingCart, ArrowLeft, FileSpreadsheet, AlertTriangle } from "lucide-react";
import StockInput from "./StockInput";

interface PageProps {
  searchParams: Promise<{ cover?: string; lead?: string }>;
}

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function ReorderPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const sp = await props.searchParams;
  const coverMonths = Math.min(24, Math.max(1, parseInt(sp.cover || "3", 10) || 3));
  const leadMonths = Math.min(12, Math.max(0, parseInt(sp.lead || "1", 10) || 0));

  const data = await computeReorder({ coverMonths, leadMonths });

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-indigo-400" /> Reorder Planner
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Suggested purchase quantities to cover {coverMonths} month{coverMonths === 1 ? "" : "s"} of demand + {leadMonths} month lead time, less on-hand stock.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <form method="GET" className="flex items-end gap-2">
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Cover (mo)</label>
              <input type="number" name="cover" min={1} max={24} defaultValue={coverMonths} className="w-20 bg-[#121420] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Lead (mo)</label>
              <input type="number" name="lead" min={0} max={12} defaultValue={leadMonths} className="w-20 bg-[#121420] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <button type="submit" className="bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 rounded-lg px-3 py-1.5 text-xs font-semibold">Apply</button>
          </form>
          <a href={`/api/service/reorder/xlsx?cover=${coverMonths}&lead=${leadMonths}`} className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-emerald-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Export PO
          </a>
          <Link href="/service/order-planner" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
            <ArrowLeft className="w-4 h-4" /> Demand
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Purchase Estimate</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(data.totalCostCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Lines to Order</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.rows.length}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Coverage</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.totalCover} mo</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider flex items-center gap-1">{data.unpricedCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-400" />} Unpriced</span>
          <span className={`text-2xl font-bold block mt-1 ${data.unpricedCount > 0 ? "text-amber-400" : "text-white"}`}>{data.unpricedCount}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {data.rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">Nothing to order — on-hand stock covers projected demand for this horizon.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Demand/mo</th>
                <th className="py-2.5 text-center">On hand</th>
                <th className="py-2.5 text-right">Target</th>
                <th className="py-2.5 text-right">Order qty</th>
                <th className="py-2.5 text-right">Unit</th>
                <th className="py-2.5 text-right">Line cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.rows.map((r) => (
                <tr key={r.key} className="hover:bg-white/[0.01]">
                  <td className="py-3">
                    {r.filterNo ? (
                      <Link href={`/service/cross-reference?q=${encodeURIComponent(r.filterNo)}`} className="font-bold text-white hover:text-indigo-400 font-mono">{r.filterNo}</Link>
                    ) : (
                      <span className="text-gray-500 italic">No part no.</span>
                    )}
                    {r.unpriced && <span className="ml-2 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5">no price</span>}
                  </td>
                  <td className="py-3 text-gray-400">{r.category}</td>
                  <td className="py-3 text-right text-gray-300">{r.monthlyQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td className="py-3 text-center"><StockInput normalizedCode={r.key} filterNo={r.filterNo} onHand={r.onHand} /></td>
                  <td className="py-3 text-right text-gray-400">{r.targetQty}</td>
                  <td className="py-3 text-right text-white font-bold">{r.orderQty}</td>
                  <td className="py-3 text-right text-gray-400">{fmtRs(r.avgUnitCents)}</td>
                  <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(r.orderCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Edit on-hand inline (auto-saves). Order qty = ceil(demand/mo × {data.totalCover}) − on hand. Demand and price come from the last 12 months of service history.</p>
      </div>
    </div>
  );
}
