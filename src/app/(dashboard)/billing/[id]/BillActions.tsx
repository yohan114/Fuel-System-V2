"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, CheckCircle2, Banknote, Save, Mail, AlertTriangle } from "lucide-react";
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
            if (res.error) setMsg({ ok: false, text: res.error });
            else setMsg({ ok: true, text: `Invoice emailed to ${res.sentTo}.` });
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

interface PaymentView {
  amountCents: number;
  paidDate: string;
  method: string | null;
  reference: string | null;
}

interface BillSnapshot {
  id: string;
  status: string;
  billingMode: string;
  rateBasis: string;
  minimumUnits: number;
  notes: string | null;
  grandTotalCents: number;
  payments: PaymentView[];
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 2 });
}

export default function BillActions({ bill }: { bill: BillSnapshot }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [clarify, setClarify] = useState<string[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  function refreshAfter(promise: Promise<{ error?: string }>) {
    setErr(null);
    startTransition(async () => {
      const res = await promise;
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  // Finalize with the clarification guard: a blocked response surfaces the
  // reasons and an override box instead of issuing.
  function finalize(reason?: string) {
    setErr(null);
    startTransition(async () => {
      const res = await finalizeBillAction(bill.id, reason);
      if (res.blocked) {
        setClarify(res.reasons);
      } else if (res.error) {
        setErr(res.error);
      } else {
        setClarify(null);
        setOverrideReason("");
        router.refresh();
      }
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
                finalize();
              }
            }}
            disabled={pending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" /> Finalize & Issue Invoice
          </button>
        </div>

        {clarify && (
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Needs clarification before issuing
            </h3>
            <ul className="space-y-1.5">
              {clarify.map((r, i) => (
                <li key={i} className="text-xs text-amber-100/90 flex gap-2">
                  <span className="text-amber-400 mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">
              Fix the draft (adjust the reading, price the fuel, then Regenerate) — or issue anyway with a reason, which is recorded on the invoice and in the audit log.
            </p>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason for issuing despite the flags (e.g. confirmed heavy-work hours with the site)"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none min-h-[60px]"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => finalize(overrideReason)}
                disabled={pending || overrideReason.trim().length === 0}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-xl flex items-center gap-2"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Issue anyway with this reason
              </button>
              <button
                onClick={() => { setClarify(null); setOverrideReason(""); }}
                disabled={pending}
                className="bg-white/5 hover:bg-white/10 border border-white/5 text-gray-300 font-semibold text-xs px-4 py-2.5 rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (bill.status === "ISSUED" || bill.status === "OVERDUE") {
    const paidCents = bill.payments.reduce((s, p) => s + p.amountCents, 0);
    const outstandingCents = Math.max(bill.grandTotalCents - paidCents, 0);
    return (
      <div className="space-y-4">
        {err && <div className="text-xs rounded-xl px-4 py-3 border bg-red-500/10 text-red-300 border-red-500/10">{err}</div>}

        {/* Payments ledger + running balance */}
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Payments</h3>
            <span className={`text-xs font-bold ${outstandingCents > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {rs(paidCents)} of {rs(bill.grandTotalCents)} · {rs(outstandingCents)} outstanding
            </span>
          </div>
          {bill.payments.length > 0 && (
            <div className="rounded-xl border border-white/5 divide-y divide-white/5">
              {bill.payments.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span className="text-gray-400 w-24 shrink-0">{new Date(p.paidDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="text-white font-semibold">{rs(p.amountCents)}</span>
                  <span className="text-gray-500 truncate flex-1">{[p.method, p.reference].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          action={(fd) => refreshAfter(markBillPaidAction(bill.id, fd))}
          className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4"
        >
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Record a Payment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Amount (LKR)</label>
              <input name="paidLkr" type="number" step="0.01" min="0" defaultValue={(outstandingCents / 100).toFixed(2)} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment Date</label>
              <input name="paidDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Method</label>
              <select name="method" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none">
                <option value="">—</option>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Transfer">Transfer</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Reference</label>
              <input name="paymentRef" placeholder="Cheque / transfer ref" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none" />
            </div>
          </div>
          <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all flex items-center gap-2">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
            Record payment {outstandingCents > 0 ? `· settles at ${rs(outstandingCents)}` : ""}
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
