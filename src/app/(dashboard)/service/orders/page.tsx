import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listPurchaseOrders } from "@/lib/service/po";
import { createBlankPoAction } from "@/app/actions/po";
import { ClipboardCheck, ShoppingCart, Plus } from "lucide-react";

function fmtRs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

const PO_STATUS: Record<string, string> = {
  DRAFT: "bg-gray-500/10 text-gray-300 border-gray-500/20",
  ORDERED: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  RECEIVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CANCELLED: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const pos = await listPurchaseOrders();

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-indigo-400" /> Purchase Orders
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Order filters and receive them against stock. Receiving a PO posts straight to the stock ledger.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/service/reorder" className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-indigo-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold">
            <ShoppingCart className="w-4 h-4 text-indigo-400" /> From Reorder
          </Link>
          <form action={createBlankPoAction}>
            <button type="submit" className="flex items-center gap-2 bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 rounded-lg px-3 py-2 text-xs font-semibold">
              <Plus className="w-4 h-4" /> New PO
            </button>
          </form>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {pos.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No purchase orders yet — create one from the Reorder Planner or start a blank PO.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">PO No.</th>
                <th className="py-2.5">Status</th>
                <th className="py-2.5">Supplier</th>
                <th className="py-2.5 text-right">Lines</th>
                <th className="py-2.5 text-right">Received</th>
                <th className="py-2.5 text-right">Order value</th>
                <th className="py-2.5 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pos.map((po) => (
                <tr key={po.id} className="hover:bg-white/[0.01]">
                  <td className="py-3">
                    <Link href={`/service/orders/${po.id}`} className="font-bold text-white hover:text-indigo-400 font-mono">{po.poNumber}</Link>
                  </td>
                  <td className="py-3">
                    <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border ${PO_STATUS[po.status] ?? PO_STATUS.DRAFT}`}>{po.status}</span>
                  </td>
                  <td className="py-3 text-gray-400">{po.supplier || "—"}</td>
                  <td className="py-3 text-right text-gray-300">{po.lineCount}</td>
                  <td className="py-3 text-right text-gray-300">{po.totalReceived}/{po.totalOrdered}</td>
                  <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(po.orderCostCents)}</td>
                  <td className="py-3 text-right text-gray-500 whitespace-nowrap">{po.createdAt.toLocaleDateString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
