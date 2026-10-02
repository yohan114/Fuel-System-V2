"use client";

import React, { useState } from "react";
import { recordPaymentAction } from "@/app/actions/billing";
import { Plus, Loader2, AlertCircle } from "lucide-react";

interface RecordPaymentModalProps {
  unpaidInvoices: {
    id: string;
    invoiceNumber: string | null;
    assetCode: string;
    projectName: string | null;
    grandTotalCents: number;
    paidAmountCents: number | null;
  }[];
}

export function RecordPaymentModal({ unpaidInvoices }: RecordPaymentModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBillId, setSelectedBillId] = useState("");

  const selectedBill = unpaidInvoices.find((b) => b.id === selectedBillId);
  const remainingCents = selectedBill ? Math.max(0, selectedBill.grandTotalCents - (selectedBill.paidAmountCents || 0)) : 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await recordPaymentAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setOpen(false);
        setSelectedBillId("");
      }
    } catch {
      setError("Failed to record payment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all"
      >
        <Plus className="w-4 h-4" />
        Record Payment
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white tracking-wide">Record Invoice Payment</h3>
            <p className="text-xs text-gray-400">
              Apply a receipt or settlement against an outstanding issued/overdue invoice.
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
                  value={selectedBillId}
                  onChange={(e) => setSelectedBillId(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Select Invoice to settle...</option>
                  {unpaidInvoices.map((inv) => {
                    const balance = inv.grandTotalCents - (inv.paidAmountCents || 0);
                    return (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber || inv.assetCode} — Balance: Rs. {(balance / 100).toLocaleString("en-LK")} ({inv.projectName || "Unassigned"})
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedBill && (
                <div className="bg-white/5 border border-white/5 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>Invoice Total:</span>
                    <span className="text-white font-medium">Rs. {(selectedBill.grandTotalCents / 100).toLocaleString("en-LK")}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Already Paid:</span>
                    <span className="text-emerald-400 font-medium">Rs. {((selectedBill.paidAmountCents || 0) / 100).toLocaleString("en-LK")}</span>
                  </div>
                  <div className="flex justify-between text-gray-300 font-semibold pt-1 border-t border-white/5">
                    <span>Remaining Balance:</span>
                    <span className="text-amber-400">Rs. {(remainingCents / 100).toLocaleString("en-LK")}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Payment Amount (Rs.)</label>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={remainingCents > 0 ? (remainingCents / 100).toFixed(2) : ""}
                  placeholder="e.g. 15000.00"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Payment Date</label>
                  <input
                    type="date"
                    name="paidDate"
                    required
                    defaultValue={new Date().toISOString().split("T")[0]}
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Payment Method</label>
                  <select
                    name="method"
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Cash">Cash</option>
                    <option value="Online">Online</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Reference / Cheque No.</label>
                <input
                  type="text"
                  name="paymentRef"
                  placeholder="e.g. CHQ-994821 or FT-2026-081"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Note (Optional)</label>
                <input
                  type="text"
                  name="paymentNote"
                  placeholder="Remarks, bank branch, etc."
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
