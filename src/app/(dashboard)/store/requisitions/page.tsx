import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { productOverview, projectOptions, requisitionList } from "@/lib/stock/queries";
import { ClipboardList, Send } from "lucide-react";
import RequisitionForm from "./RequisitionForm";
import RequisitionActions from "./RequisitionActions";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  SENT: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  RECEIVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  REJECTED: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  CANCELLED: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function qty(n: number | null) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default async function RequisitionsPage() {
  const session = await getSession();
  if (!session) return null;
  if (!["ADMIN", "STOREKEEPER", "USER"].includes(session.role)) redirect("/");
  const canManage = session.role === "ADMIN" || session.role === "STOREKEEPER";

  const [overview, projects, list] = await Promise.all([productOverview(), projectOptions(), requisitionList()]);
  const products = overview.rows.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, unit: p.unit }));

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-indigo-400" /> Material Requisitions
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          A site requests lubricant → the store keeper approves &amp; sends (stock leaves the store, over-issue-guarded) → the site confirms what was received; shortfalls are flagged.
        </p>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <Send className="w-4 h-4 text-emerald-400" /> New request
        </h2>
        <RequisitionForm products={products} projects={projects} />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Requisitions</h2>
        {list.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No requisitions yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Product</th>
                <th className="py-2.5">Destination</th>
                <th className="py-2.5 text-right">Req</th>
                <th className="py-2.5 text-right">Sent</th>
                <th className="py-2.5 text-right">Recv</th>
                <th className="py-2.5">Status</th>
                <th className="py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-gray-400 whitespace-nowrap">{r.createdAt.toLocaleDateString("en-GB")}</td>
                  <td className="py-3 font-semibold text-white">{r.productName} <span className="text-gray-500">{r.unit}</span></td>
                  <td className="py-3 text-gray-300">{r.projectName ?? "—"}{r.siteName ? ` · ${r.siteName}` : ""}</td>
                  <td className="py-3 text-right text-gray-300">{qty(r.qtyRequested)}</td>
                  <td className="py-3 text-right text-gray-300">{qty(r.qtySent)}</td>
                  <td className={`py-3 text-right ${r.discrepancy ? "text-amber-400 font-semibold" : "text-gray-300"}`}>{qty(r.qtyReceived)}{r.discrepancy ? " ⚠" : ""}</td>
                  <td className="py-3"><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border ${STATUS_STYLE[r.status] ?? STATUS_STYLE.CANCELLED}`}>{r.status}</span></td>
                  <td className="py-3"><RequisitionActions id={r.id} status={r.status} qtyRequested={r.qtyRequested} qtySent={r.qtySent} canManage={canManage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
