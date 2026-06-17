"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, CheckCircle2, Banknote, Save, Mail } from "lucide-react";
import {
  updateBillDraftAction,
  regenerateBillAction,
  finalizeBillAction,
  markBillPaidAction,
  emailInvoiceAction,
} from "@/app/actions/billing";

function EmailInvoiceButton({ billId }: { billId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2">
      <button
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const res = await emailInvoiceAction(billId);
            if ((res as any).error) setMsg({ ok: false, text: (res as any).error });
            else setMsg({ ok: true, text: `Invoice emailed to ${(res as any).sentTo}.` });
          })
        }
        disabled={pending}
        className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        Email Invoice to Site
      </button>
      {msg && (
        <div className={`text-xs rounded-xl px-4 py-2.5 border ${msg.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/10" : "bg-red-500/10 text-red-300 border-red-500/10"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

interface BillSnapshot {
  id: string;
  status: string;
  billingMode: string;
  rateBasis: string;
  minimumUnits: number;
  notes: string | null;
  grandTotalCents: number;
}

export default function BillActions({ bill }: { bill: BillSnapshot }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function refreshAfter(promise: Promise<any>) {
    setErr(null);
    startTransition(async () => {
      const res = await promise;
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  if (bill.status === "DRAFT") {
    return (
      <div className="space-y-4">
        {err && <div className="text-xs rounded-xl px-4 py-3 border bg-red-500/10 text-red-300 border-red-500/10">{err}</div>}

        <form
          action={(fd) => refreshAfter(updateBillDraftAction(bill.id, fd))}
          className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4"
        >
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Adjust Draft</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Billing Mode</label>
              <select name="billingMode" defaultValue={bill.billingMode} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                <option value="hourly">Hourly</option>
                <option value="perkm">Per-KM</option>
                <option value="perday">Per-Day</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Rate Basis</label>
              <select name="rateBasis" defaultValue={bill.rateBasis} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                <option value="fw">Fully Wet (incl. fuel)</option>
                <option value="w">Wet (driver only)</option>
                <option value="d">Dry (vehicle only)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Minimum Guaranteed</label>
              <input name="minimumUnits" type="number" step="0.5" min="0" defaultValue={bill.minimumUnits} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes</label>
            <input name="notes" defaultValue={bill.notes || ""} placeholder="Optional note on the statement" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
          </div>
          <button type="submit" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all flex items-center gap-2">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save & Recompute
          </button>
        </form>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => refreshAfter(regenerateBillAction(bill.id))}
            disabled={pending}
            className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" /> Regenerate from data
          </button>
          <button
            onClick={() => {
              if (confirm("Issue this invoice? It will be locked from further edits.")) {
                refreshAfter(finalizeBillAction(bill.id));
              }
            }}
            disabled={pending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" /> Finalize & Issue Invoice
          </button>
        </div>
      </div>
    );
  }

  if (bill.status === "ISSUED" || bill.status === "OVERDUE") {
    return (
      <div className="space-y-4">
        {err && <div className="text-xs rounded-xl px-4 py-3 border bg-red-500/10 text-red-300 border-red-500/10">{err}</div>}
        <form
          action={(fd) => refreshAfter(markBillPaidAction(bill.id, fd))}
          className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4"
        >
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Record Payment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Amount (LKR)</label>
              <input name="paidLkr" type="number" step="0.01" min="0" defaultValue={(bill.grandTotalCents / 100).toFixed(2)} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment Date</label>
              <input name="paidDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Reference</label>
              <input name="paymentRef" placeholder="Cheque / transfer ref" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
          </div>
          <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all flex items-center gap-2">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
            Mark as Paid
          </button>
        </form>
        <EmailInvoiceButton billId={bill.id} />
      </div>
    );
  }

  if (bill.status === "PAID") {
    return <EmailInvoiceButton billId={bill.id} />;
  }

  return null;
}
