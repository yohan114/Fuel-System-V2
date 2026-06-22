"use client";

import React, { useState } from "react";
import {
  sendRequisitionAction,
  receiveRequisitionAction,
  rejectRequisitionAction,
  cancelRequisitionAction,
} from "@/app/actions/requisition";

interface Props {
  id: string;
  status: string;
  qtyRequested: number | null;
  qtySent: number | null;
  canManage: boolean;
}

// Contextual workflow controls for one requisition row.
export default function RequisitionActions({ id, status, qtyRequested, qtySent, canManage }: Props) {
  const [qty, setQty] = useState(String(status === "SENT" ? qtySent ?? "" : qtyRequested ?? ""));
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(action: (fd: FormData) => Promise<{ error?: string } | void>, extra?: Record<string, string>) {
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.set("id", id);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const res = await action(fd);
    setPending(false);
    if (res && "error" in res && res.error) setErr(res.error);
  }

  if (status === "PENDING") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <input type="number" step="0.01" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1 text-white text-xs text-right" />
            <button disabled={pending} onClick={() => run(sendRequisitionAction, { qtySent: qty })} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-2.5 py-1">Send</button>
            <button disabled={pending} onClick={() => run(rejectRequisitionAction, { reason: "" })} className="text-rose-400 hover:text-rose-300 text-xs font-semibold">Reject</button>
          </>
        )}
        <button disabled={pending} onClick={() => run(cancelRequisitionAction)} className="text-gray-400 hover:text-white text-xs font-semibold">Cancel</button>
        {err && <span className="text-[9px] text-red-400">{err}</span>}
      </div>
    );
  }

  if (status === "SENT") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" step="0.01" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1 text-white text-xs text-right" />
        <button disabled={pending} onClick={() => run(receiveRequisitionAction, { qtyReceived: qty })} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-2.5 py-1">Confirm receipt</button>
        {err && <span className="text-[9px] text-red-400">{err}</span>}
      </div>
    );
  }

  return <span className="text-gray-600">—</span>;
}
