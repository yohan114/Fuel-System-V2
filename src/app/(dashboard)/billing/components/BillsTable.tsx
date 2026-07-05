"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Banknote, Loader2 } from "lucide-react";
import { bulkFinalizeBillsAction, bulkMarkPaidAction } from "@/app/actions/billing";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};
const MODE_LABEL: Record<string, string> = { hourly: "Hourly", perkm: "Per-KM", perday: "Per-Day" };

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export interface BillRow {
  id: string;
  assetCode: string;
  assetLabel: string | null;
  projectName: string | null;
  billingMode: string;
  rateBasis: string;
  billableUnits: number;
  rentalAmountCents: number;
  fuelCostCents: number;
  grandTotalCents: number;
  status: string;
  meterCheck: string | null; // formatted variance when fuel-implied units differ ≥20% from the chart
}

export default function BillsTable({ bills, isAdmin }: { bills: BillRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const draftIds = useMemo(() => bills.filter((b) => b.status === "DRAFT").map((b) => b.id), [bills]);
  const payableIds = useMemo(
    () => bills.filter((b) => b.status === "ISSUED" || b.status === "OVERDUE").map((b) => b.id),
    [bills]
  );

  const selectedArr = Array.from(selected);
  const selectedDrafts = selectedArr.filter((id) => draftIds.includes(id));
  const selectedPayable = selectedArr.filter((id) => payableIds.includes(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === bills.length ? new Set() : new Set(bills.map((b) => b.id))));
  }

  function runFinalize() {
    if (selectedDrafts.length === 0) return;
    if (!confirm(`Finalize & issue ${selectedDrafts.length} draft invoice(s)? They will be locked.`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkFinalizeBillsAction(selectedDrafts);
      if ((res as any).error) setMsg({ ok: false, text: (res as any).error });
      else {
        const r = res as any;
        setMsg({ ok: true, text: `Finalized ${r.finalized}, skipped ${r.skipped}${r.errors?.length ? `, ${r.errors.length} errors` : ""}.` });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function runMarkPaid() {
    if (selectedPayable.length === 0) return;
    if (!confirm(`Mark ${selectedPayable.length} invoice(s) as fully paid (today)?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkMarkPaidAction(selectedPayable);
      if ((res as any).error) setMsg({ ok: false, text: (res as any).error });
      else {
        const r = res as any;
        setMsg({ ok: true, text: `Marked ${r.paid} paid, skipped ${r.skipped}${r.errors?.length ? `, ${r.errors.length} errors` : ""}.` });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {isAdmin && selected.size > 0 && (
        <div className="bg-[#1b1e30] border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-300 font-semibold">{selected.size} selected</span>
          <button
            onClick={runFinalize}
            disabled={pending || selectedDrafts.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-all"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Finalize {selectedDrafts.length || ""} draft{selectedDrafts.length === 1 ? "" : "s"}
          </button>
          <button
            onClick={runMarkPaid}
            disabled={pending || selectedPayable.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-all"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
            Mark {selectedPayable.length || ""} paid
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-white ml-auto">
            Clear
          </button>
        </div>
      )}

      {msg && (
        <div className={`text-xs rounded-xl px-4 py-3 border ${msg.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/10" : "bg-red-500/10 text-red-300 border-red-500/10"}`}>
          {msg.text}
        </div>
      )}

      <div className="border border-white/5 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              {isAdmin && (
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === bills.length && bills.length > 0}
                    onChange={toggleAll}
                    className="accent-indigo-500 w-3.5 h-3.5"
                  />
                </th>
              )}
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Site</th>
              <th className="px-4 py-3">Mode / Basis</th>
              <th className="px-4 py-3 text-right">Billable</th>
              <th className="px-4 py-3 text-right">Rental</th>
              <th className="px-4 py-3 text-right">Fuel</th>
              <th className="px-4 py-3 text-right">Grand Total</th>
              <th className="px-4 py-3">Meter check</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bills.map((b) => (
              <tr key={b.id} className={`hover:bg-white/[0.02] ${selected.has(b.id) ? "bg-indigo-500/[0.04]" : ""}`}>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggle(b.id)}
                      className="accent-indigo-500 w-3.5 h-3.5"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/billing/${b.id}`} className="font-semibold text-white hover:text-indigo-400">
                    {b.assetCode}
                  </Link>
                  <div className="text-gray-500">{b.assetLabel}</div>
                </td>
                <td className="px-4 py-3 text-gray-400">{b.projectName || "Unassigned"}</td>
                <td className="px-4 py-3 text-gray-400">
                  {MODE_LABEL[b.billingMode]} <span className="text-gray-600">·</span> {b.rateBasis.toUpperCase()}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {b.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">{rs(b.rentalAmountCents)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{b.fuelCostCents > 0 ? rs(b.fuelCostCents) : "—"}</td>
                <td className="px-4 py-3 text-right font-bold text-white">{rs(b.grandTotalCents)}</td>
                <td className="px-4 py-3">
                  {b.meterCheck ? (
                    <span
                      className="px-2 py-0.5 rounded text-[9px] font-bold border bg-amber-500/10 text-amber-400 border-amber-500/10 whitespace-nowrap"
                      title="Fuel-implied running differs from the running chart — clarify with the site (see the bill's usage panel)"
                    >
                      CLARIFY {b.meterCheck}
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${STATUS_STYLES[b.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
