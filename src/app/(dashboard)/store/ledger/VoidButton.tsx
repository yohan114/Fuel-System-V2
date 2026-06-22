"use client";

import React, { useState } from "react";
import { voidStockMovementAction } from "@/app/actions/inventory";

// Soft-void a movement (kept for audit). Confirms first; the server refuses a
// void that would drive the balance negative.
export default function VoidButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    if (!confirm("Void this movement? It stays in the audit trail but is excluded from balances.")) return;
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.set("id", id);
    const res = await voidStockMovementAction(fd);
    setPending(false);
    if (res?.error) setErr(res.error);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={onClick} disabled={pending} className="text-[10px] font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50">
        {pending ? "…" : "Void"}
      </button>
      {err && <span className="text-[9px] text-red-400" title={err}>!</span>}
    </span>
  );
}
