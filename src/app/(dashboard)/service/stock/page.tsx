import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { stockOverview, recentStockMovements } from "@/lib/service/stock";
import { Boxes, ShoppingCart, ArrowRight, AlertTriangle, PackagePlus, ScrollText } from "lucide-react";
import StockInput from "../reorder/StockInput";
import ReceiveForm from "./ReceiveForm";

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

function cover(months: number | null): { text: string; cls: string } {
  if (months == null) return { text: "—", cls: "text-gray-600" };
  if (months >= 100) return { text: "99+ mo", cls: "text-emerald-400" };
  const text = `${months.toFixed(1)} mo`;
  const cls = months < 1 ? "text-red-400" : months < 2 ? "text-amber-400" : "text-gray-300";
  return { text, cls };
}

const REASON_STYLE: Record<string, string> = {
  RECEIPT: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CONSUMPTION: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  ADJUSTMENT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  OPENING: "bg-gray-500/10 text-gray-300 border-gray-500/20",
};

export default async function StockPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const [data, ledger] = await Promise.all([stockOverview(), recentStockMovements(60)]);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-400" /> Filter Stock
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Live on-hand inventory. Stock falls automatically as services consume filters and rises as you record receipts — every change is recorded below.
          </p>
        </div>
        <Link href="/service/reorder" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          Reorder Planner <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Stock Value</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(data.totalValueCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Units On Hand</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.totalUnits.toLocaleString()}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">SKUs Tracked</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.skuCount}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider flex items-center gap-1">
            {data.lowStockCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-400" />} Low Stock
          </span>
          <span className={`text-2xl font-bold block mt-1 ${data.lowStockCount > 0 ? "text-amber-400" : "text-white"}`}>{data.lowStockCount}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <PackagePlus className="w-4 h-4 text-emerald-400" /> Record a receipt
        </h2>
        <ReceiveForm />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Inventory</h2>
        {data.rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No stock tracked yet — record a receipt above, or log a detailed service.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Demand/mo</th>
                <th className="py-2.5 text-center">On hand</th>
                <th className="py-2.5 text-right">Cover</th>
                <th className="py-2.5 text-right">Unit</th>
                <th className="py-2.5 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.rows.map((r) => {
                const c = cover(r.monthsCover);
                return (
                  <tr key={r.key} className="hover:bg-white/[0.01]">
                    <td className="py-3">
                      {r.filterNo ? (
                        <Link href={`/service/cross-reference?q=${encodeURIComponent(r.filterNo)}`} className="font-bold text-white hover:text-indigo-400 font-mono">{r.filterNo}</Link>
                      ) : (
                        <span className="text-gray-500 italic">No part no.</span>
                      )}
                    </td>
                    <td className="py-3 text-gray-400">{r.category}</td>
                    <td className="py-3 text-right text-gray-300">{r.monthlyQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="py-3 text-center"><StockInput normalizedCode={r.key} filterNo={r.filterNo} onHand={r.onHand} /></td>
                    <td className={`py-3 text-right font-semibold ${c.cls}`}>{c.text}</td>
                    <td className="py-3 text-right text-gray-400">{fmtRs(r.avgUnitCents)}</td>
                    <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(r.valueCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Edit on-hand inline (auto-saves as an audited adjustment). Cover = on-hand ÷ monthly demand; value uses the average unit price from the last 12 months of service history.</p>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <ScrollText className="w-4 h-4 text-indigo-400" /> Recent movements
        </h2>
        {ledger.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No stock movements yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5 text-right">Change</th>
                <th className="py-2.5 text-right">Balance</th>
                <th className="py-2.5">By</th>
                <th className="py-2.5">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ledger.map((m) => (
                <tr key={m.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-gray-400 whitespace-nowrap">{m.createdAt.toLocaleDateString("en-GB")}</td>
                  <td className="py-3 font-mono text-white">{m.filterNo || <span className="text-gray-500">{m.normalizedCode}</span>}</td>
                  <td className="py-3">
                    <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border ${REASON_STYLE[m.reason] ?? REASON_STYLE.OPENING}`}>
                      {m.reason}
                    </span>
                  </td>
                  <td className={`py-3 text-right font-bold ${m.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {m.delta >= 0 ? "+" : ""}{m.delta}
                  </td>
                  <td className="py-3 text-right text-gray-300">{m.balanceAfter}</td>
                  <td className="py-3 text-gray-400">{m.actorName ?? "—"}</td>
                  <td className="py-3 text-gray-500">{m.note ?? (m.unitCostCents != null ? `@ ${fmtRs(m.unitCostCents)}/unit` : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
