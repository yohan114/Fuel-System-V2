"use client";

import React, { useState } from "react";
import { receiveStockAction } from "@/app/actions/inventory";

interface ProductOpt { id: string; name: string; unit: string }

export default function ReceiveForm({ products }: { products: ProductOpt[] }) {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await receiveStockAction(new FormData(form));
    setPending(false);
    if (res?.error) setMsg({ type: "err", text: res.error });
    else {
      setMsg({ type: "ok", text: `Received — balance now ${res?.balanceAfter ?? "updated"}.` });
      form.reset();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
      <div className="sm:col-span-2">
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Product</label>
        <select name="productId" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">Select…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Qty received</label>
        <input type="number" step="0.01" min={0} name="qty" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Date</label>
        <input type="date" name="txnDate" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <input type="text" name="note" placeholder="note (optional)" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs mb-1" />
        <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Receive"}
        </button>
        {msg && <span className={`text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
