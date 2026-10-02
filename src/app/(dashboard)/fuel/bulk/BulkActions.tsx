"use client";

import React, { useState } from "react";
import {
  createBulkRequestAction,
  approveBulkRequestAction,
  rejectBulkRequestAction,
} from "@/app/actions/integrity";
import { Plus, Check, X, Loader2, AlertCircle, ArrowRightLeft, Truck } from "lucide-react";

interface BulkActionsProps {
  tanks: { id: string; name: string; fuelKind: string; balance: number }[];
}

export function RequestBulkModal({ tanks }: BulkActionsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<"OUTSIDE" | "SITE">("OUTSIDE");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await createBulkRequestAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setOpen(false);
      }
    } catch {
      setError("Failed to submit request");
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
        Request Bulk Fuel / Transfer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white tracking-wide">
              Request Bulk Tank Refill / Transfer
            </h3>
            <p className="text-xs text-gray-400">
              Request a bowser delivery from an outside supplier or a transfer from another site tank.
            </p>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">Source Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType("OUTSIDE")}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      sourceType === "OUTSIDE"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-400"
                        : "bg-white/5 border-white/10 text-gray-400 hover:text-white"
                    }`}
                  >
                    <Truck className="w-4 h-4" />
                    Supplier Delivery
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType("SITE")}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      sourceType === "SITE"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-400"
                        : "bg-white/5 border-white/10 text-gray-400 hover:text-white"
                    }`}
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Tank-to-Tank Transfer
                  </button>
                </div>
                <input type="hidden" name="sourceType" value={sourceType} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Target Bulk Tank</label>
                <select
                  name="bulkTankId"
                  required
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select Target Tank...</option>
                  {tanks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (Balance: {t.balance.toFixed(0)} L)
                    </option>
                  ))}
                </select>
              </div>

              {sourceType === "SITE" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Source Tank</label>
                  <select
                    name="sourceTankId"
                    required
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select Source Tank...</option>
                    {tanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (Available: {t.balance.toFixed(0)} L)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Fuel Kind</label>
                  <select
                    name="fuelKind"
                    required
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="AUTO_DIESEL">Auto Diesel</option>
                    <option value="SUPER_DIESEL">Super Diesel</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Requested Litres</label>
                  <input
                    type="number"
                    name="requestedLitres"
                    step="1"
                    min="1"
                    required
                    placeholder="e.g. 5000"
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
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
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function BulkRequestItemActions({ requestId }: { requestId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    if (!confirm("Approve this bulk tank refill / transfer? Tank balances will update immediately.")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await approveBulkRequestAction(requestId);
      if (res.error) setError(res.error);
    } catch {
      setError("Failed to approve");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    const note = prompt("Enter rejection reason (optional):");
    if (note === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await rejectBulkRequestAction(requestId, note);
      if (res.error) setError(res.error);
    } catch {
      setError("Failed to reject");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all disabled:opacity-50"
          title="Approve & Update Balance"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleReject}
          disabled={loading}
          className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-50"
          title="Reject"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {error && <span className="text-[10px] text-rose-400">{error}</span>}
    </div>
  );
}
