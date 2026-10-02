"use client";

import React, { useState } from "react";
import { issueCreditNoteAction, createCreditNoteAction } from "@/app/actions/finance";
import { Plus, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

interface CreditNoteActionsProps {
  creditNoteId?: string;
  isDraft?: boolean;
  issuedInvoices?: { id: string; invoiceNumber: string | null; assetCode: string; grandTotalCents: number }[];
}

export function IssueCreditNoteButton({ creditNoteId }: { creditNoteId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleIssue = async () => {
    if (!confirm("Are you sure you want to issue this credit note? A formal CN number will be generated.")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await issueCreditNoteAction(creditNoteId);
      if (res.error) setError(res.error);
    } catch {
      setError("Failed to issue credit note");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleIssue}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 text-xs font-semibold border border-emerald-500/20 transition-all disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        Issue
      </button>
      {error && <span className="text-[10px] text-rose-400">{error}</span>}
    </div>
  );
}

export function CreateCreditNoteModal({
  issuedInvoices,
}: {
  issuedInvoices: { id: string; invoiceNumber: string | null; assetCode: string; grandTotalCents: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await createCreditNoteAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setOpen(false);
      }
    } catch {
      setError("Failed to create credit note");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
      >
        <Plus className="w-4 h-4" />
        Draft Credit Note
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white tracking-wide">Draft New Credit Note</h3>
            <p className="text-xs text-gray-400">
              Select an issued invoice to credit. The draft credit note can be reviewed before issuing.
            </p>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Invoice</label>
                <select
                  name="billId"
                  required
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select Invoice...</option>
                  {issuedInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber || inv.assetCode} (Rs. {(inv.grandTotalCents / 100).toLocaleString("en-LK")})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Amount (Rs.)</label>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="e.g. 5000.00"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Reason for Credit</label>
                <textarea
                  name="reason"
                  required
                  rows={3}
                  placeholder="Discount, rate adjustment, breakdown deduction, client dispute..."
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
