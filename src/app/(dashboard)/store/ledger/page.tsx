import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { productOverview, recentMovements, projectOptions } from "@/lib/stock/queries";
import { Droplets, PackagePlus, Send, ScrollText } from "lucide-react";
import ReceiveForm from "./ReceiveForm";
import IssueForm from "./IssueForm";
import VoidButton from "./VoidButton";

const KIND_STYLE: Record<string, string> = {
  RECEIPT: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  ISSUE: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  ADJUSTMENT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  OPENING: "bg-gray-500/10 text-gray-300 border-gray-500/20",
};

export default async function StoreLedgerPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "STOREKEEPER") redirect("/");

  const [overview, ledger, projects] = await Promise.all([
    productOverview(),
    recentMovements(80),
    projectOptions(),
  ]);
  const products = overview.rows.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, unit: p.unit }));

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Droplets className="w-5 h-5 text-indigo-400" /> Oil Stock Ledger
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Record receipts and issues; the running balance updates automatically. Issues link to a machine or project — the server refuses any issue that would drive a balance negative.
        </p>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <PackagePlus className="w-4 h-4 text-emerald-400" /> Receive stock
        </h2>
        <ReceiveForm products={products} />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <Send className="w-4 h-4 text-indigo-400" /> Issue stock
        </h2>
        <IssueForm products={products} projects={projects} />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <ScrollText className="w-4 h-4 text-indigo-400" /> Recent movements
        </h2>
        {ledger.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No stock movements yet — record a receipt above, or run the importer.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Product</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5">Consumer</th>
                <th className="py-2.5 text-right">Change</th>
                <th className="py-2.5 text-right">Balance</th>
                <th className="py-2.5">By</th>
                <th className="py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ledger.map((m) => {
                const change = m.qtyReceived - m.qtyIssued;
                return (
                  <tr key={m.id} className={`hover:bg-white/[0.01] ${m.voided ? "opacity-40 line-through" : ""}`}>
                    <td className="py-3 text-gray-400 whitespace-nowrap">{m.txnDate.toLocaleDateString("en-GB")}</td>
                    <td className="py-3 font-semibold text-white">{m.productName}</td>
                    <td className="py-3">
                      <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border ${KIND_STYLE[m.kind] ?? KIND_STYLE.OPENING}`}>{m.kind}</span>
                    </td>
                    <td className="py-3 text-gray-300">{m.consumerLabel}</td>
                    <td className={`py-3 text-right font-bold ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {change >= 0 ? "+" : ""}{change.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 text-right text-gray-300">{m.balanceAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-3 text-gray-400">{m.actorName ?? "—"}</td>
                    <td className="py-3 text-right">{!m.voided && <VoidButton id={m.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
