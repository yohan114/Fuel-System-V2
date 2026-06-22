import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPurchaseOrder, poProgress } from "@/lib/service/po";
import {
  addPoLineAction,
  removePoLineAction,
  updatePoMetaAction,
  markPoOrderedAction,
  receivePoAction,
  cancelPoAction,
} from "@/app/actions/po";
import { ArrowLeft, ClipboardCheck, Truck, Trash2, Plus, PackageCheck } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtRs(cents: number | null | undefined) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

const PO_STATUS: Record<string, string> = {
  DRAFT: "bg-gray-500/10 text-gray-300 border-gray-500/20",
  ORDERED: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  RECEIVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CANCELLED: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export default async function OrderDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const { id } = await props.params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  const prog = poProgress(po.lines);
  const isDraft = po.status === "DRAFT";
  const isOrdered = po.status === "ORDERED";
  const editable = isDraft || isOrdered;

  return (
    <div className="space-y-6">
      <Link href="/service/orders" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 w-max">
        <ArrowLeft className="w-4 h-4" /> Purchase Orders
      </Link>

      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2 font-mono">
            <ClipboardCheck className="w-5 h-5 text-indigo-400" /> {po.poNumber}
            <span className={`text-[10px] font-semibold rounded px-2 py-0.5 border ${PO_STATUS[po.status] ?? PO_STATUS.DRAFT}`}>{po.status}</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Created {po.createdAt.toLocaleDateString("en-GB")}
            {po.orderedAt ? ` · Ordered ${po.orderedAt.toLocaleDateString("en-GB")}` : ""}
            {po.receivedAt ? ` · Received ${po.receivedAt.toLocaleDateString("en-GB")}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Order value</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(prog.orderCostCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Received value</span>
          <span className="text-2xl font-bold text-white block mt-1">{fmtRs(prog.receivedCostCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Units received</span>
          <span className="text-2xl font-bold text-white block mt-1">{prog.totalReceived}<span className="text-sm text-gray-500"> / {prog.totalOrdered}</span></span>
        </div>
      </div>

      {/* Supplier / note */}
      {editable && (
        <form action={updatePoMetaAction} className="bg-[#121420] border border-white/5 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <input type="hidden" name="poId" value={po.id} />
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Supplier</label>
            <input name="supplier" defaultValue={po.supplier ?? ""} placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Note</label>
            <input name="note" defaultValue={po.note ?? ""} placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <button type="submit" className="bg-[#1b1e30] border border-white/10 hover:border-indigo-500/30 text-gray-300 hover:text-white font-semibold text-xs rounded-xl px-4 py-2.5">Save details</button>
        </form>
      )}

      {/* Lines */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Line items</h2>

        {po.lines.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-500">No lines yet{isDraft ? " — add one below or create the PO from the Reorder Planner." : "."}</div>
        ) : isOrdered ? (
          <form action={receivePoAction}>
            <input type="hidden" name="poId" value={po.id} />
            <LinesTable poId={po.id} lines={po.lines} mode="receive" />
            <div className="flex justify-end mt-4">
              <button type="submit" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
                <Truck className="w-4 h-4" /> Receive entered quantities
              </button>
            </div>
          </form>
        ) : (
          <LinesTable poId={po.id} lines={po.lines} mode={isDraft ? "draft" : "view"} />
        )}

        {/* Add line (draft only) */}
        {isDraft && (
          <form action={addPoLineAction} className="mt-5 pt-5 border-t border-white/5 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            <input type="hidden" name="poId" value={po.id} />
            <div className="col-span-2 sm:col-span-2">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Filter part no.</label>
              <input name="filterNo" required placeholder="e.g. FF5045" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs font-mono uppercase" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Category</label>
              <input name="category" placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Qty</label>
              <input name="qty" type="number" min={1} defaultValue={1} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Unit (Rs.)</label>
                <input name="unitCostLkr" type="number" step="0.01" min={0} placeholder="opt." className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
              </div>
              <button type="submit" className="bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 rounded-xl px-3 py-2.5 text-xs font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /></button>
            </div>
          </form>
        )}
      </div>

      {/* Status actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {isDraft && (
          <form action={markPoOrderedAction}>
            <input type="hidden" name="poId" value={po.id} />
            <button type="submit" disabled={po.lines.length === 0} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
              <PackageCheck className="w-4 h-4" /> Mark as ordered
            </button>
          </form>
        )}
        {editable && (
          <form action={cancelPoAction}>
            <input type="hidden" name="poId" value={po.id} />
            <button type="submit" className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 font-semibold text-xs rounded-xl px-4 py-2.5">
              <Trash2 className="w-4 h-4" /> Cancel PO
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type LineMode = "draft" | "receive" | "view";

interface PoLineView {
  id: string;
  filterNo: string | null;
  normalizedCode: string;
  category: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostCents: number | null;
}

function LinesTable({ poId, lines, mode }: { poId: string; lines: PoLineView[]; mode: LineMode }) {
  return (
    <table className="w-full text-left text-xs border-collapse">
      <thead>
        <tr className="text-gray-400 font-semibold border-b border-white/5">
          <th className="py-2.5">Filter</th>
          <th className="py-2.5">Category</th>
          <th className="py-2.5 text-right">Ordered</th>
          <th className="py-2.5 text-right">Received</th>
          <th className="py-2.5 text-right">Unit</th>
          <th className="py-2.5 text-right">Line cost</th>
          {mode === "receive" && <th className="py-2.5 text-right">Receive now</th>}
          {mode === "draft" && <th className="py-2.5"></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {lines.map((l) => {
          const remaining = Math.max(0, l.qtyOrdered - l.qtyReceived);
          return (
            <tr key={l.id} className="hover:bg-white/[0.01]">
              <td className="py-3">
                {l.filterNo ? (
                  <Link href={`/service/cross-reference?q=${encodeURIComponent(l.filterNo)}`} className="font-bold text-white hover:text-indigo-400 font-mono">{l.filterNo}</Link>
                ) : (
                  <span className="text-gray-500 italic font-mono">{l.normalizedCode}</span>
                )}
              </td>
              <td className="py-3 text-gray-400">{l.category || "—"}</td>
              <td className="py-3 text-right text-gray-300">{l.qtyOrdered}</td>
              <td className="py-3 text-right text-gray-300">{l.qtyReceived}{remaining > 0 && l.qtyReceived > 0 ? <span className="text-gray-600"> (+{remaining})</span> : ""}</td>
              <td className="py-3 text-right text-gray-400">{fmtRs(l.unitCostCents)}</td>
              <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(l.unitCostCents != null ? l.unitCostCents * l.qtyOrdered : null)}</td>
              {mode === "receive" && (
                <td className="py-3 text-right">
                  {remaining > 0 ? (
                    <input name={`recv_${l.id}`} type="number" min={0} max={remaining} defaultValue={0} className="w-16 bg-[#1b1e30] border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-emerald-500/50" />
                  ) : (
                    <span className="text-[10px] text-emerald-400/70">done</span>
                  )}
                </td>
              )}
              {mode === "draft" && (
                <td className="py-3 text-right">
                  <form action={removePoLineAction} className="inline">
                    <input type="hidden" name="poId" value={poId} />
                    <input type="hidden" name="lineId" value={l.id} />
                    <button type="submit" className="text-gray-500 hover:text-rose-400" aria-label="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
                  </form>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
