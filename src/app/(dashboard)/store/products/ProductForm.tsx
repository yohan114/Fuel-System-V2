"use client";

import React, { useState } from "react";
import { createProductAction } from "@/app/actions/inventory";

// Add a stock product. Mirrors the repo's client-form convention: submit via the
// server action, show a transient message, reset on success (the action
// revalidates the page data).
export default function ProductForm() {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await createProductAction(new FormData(form));
    setPending(false);
    if (res?.error) setMsg({ type: "err", text: res.error });
    else {
      setMsg({ type: "ok", text: "Product added." });
      form.reset();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
      <div className="sm:col-span-2">
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Product name</label>
        <input type="text" name="name" required placeholder="e.g. 15W40 (CI-04) Servo" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Unit</label>
        <input type="text" name="unit" defaultValue="L" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Category</label>
        <input type="text" name="category" placeholder="engine_oil" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Reorder level</label>
        <input type="number" step="0.01" min={0} name="reorderLevel" placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Unit price (Rs.)</label>
        <input type="number" step="0.01" min={0} name="unitPrice" placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div className="sm:col-span-6 flex items-center gap-3">
        <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Add product"}
        </button>
        {msg && <span className={`text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
