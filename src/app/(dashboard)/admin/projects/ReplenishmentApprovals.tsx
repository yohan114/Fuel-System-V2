"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { approveBulkRequestAction, rejectBulkRequestAction } from "@/app/actions/workshop";

interface Req {
  id: string;
  tankName: string;
  fuelKind: string;
  requestedByName: string;
  createdAt: string;
  requestedLitres: number;
}

// Client-side approve/reject so the admin gets real feedback: a loading state,
// a surfaced error when the action fails, and a refresh on success. Previously
// these were inline server-action <form>s whose {error} result was thrown away,
// so a failed approval looked like "nothing happened when I clicked".
export default function ReplenishmentApprovals({ requests }: { requests: Req[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (requests.length === 0) return null;

  const run = (
    id: string,
    action: (id: string, note: string | null) => Promise<{ error?: string; success?: boolean }>,
    note: string,
  ) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await action(id, note);
      setBusyId(null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-6 shadow-md space-y-4">
      <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
        <Layers className="w-4 h-4 text-amber-400" />
        Pending Replenishment Approvals ({requests.length})
      </h3>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 text-red-400 text-xs px-3 py-2 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="divide-y divide-white/5">
        {requests.map((req) => (
          <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4 text-xs">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">{req.tankName}</span>
                <span className="text-[10px] bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded uppercase">
                  {req.fuelKind.replace("_", " ")}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Requested by {req.requestedByName} • {new Date(req.createdAt).toLocaleString()}
              </p>
              <p className="text-white font-bold mt-2 text-md">
                Request Quantity: {req.requestedLitres.toLocaleString()} L
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(req.id, approveBulkRequestAction, "Approved by Admin")}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all shadow-md"
              >
                {busyId === req.id && isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Approve Refuel
              </button>

              <button
                type="button"
                disabled={isPending}
                onClick={() => run(req.id, rejectBulkRequestAction, "Rejected by Admin")}
                className="flex items-center gap-1 bg-white/5 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 border border-white/5 font-semibold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all"
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
