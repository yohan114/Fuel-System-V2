"use client";

import React, { useState } from "react";
import { createRequisitionAction } from "@/app/actions/requisition";

interface ProductOpt { id: string; name: string; unit: string }
interface ProjectOpt { id: string; name: string; sites: { id: string; name: string }[] }

export default function RequisitionForm({ products, projects }: { products: ProductOpt[]; projects: ProjectOpt[] }) {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState("");
  const sites = projects.find((p) => p.id === projectId)?.sites ?? [];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await createRequisitionAction(new FormData(form));
    setPending(false);
    if (res?.error) setMsg({ type: "err", text: res.error });
    else { setMsg({ type: "ok", text: "Request submitted." }); form.reset(); setProjectId(""); }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
      <div className="sm:col-span-2">
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Product</label>
        <select name="productId" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">Select…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Qty</label>
        <input type="number" step="0.01" min={0} name="qtyRequested" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Project</label>
        <select name="projectId" required value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">Select…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Site</label>
        <select name="siteId" disabled={!sites.length} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs disabled:opacity-40">
          <option value="">—</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <input type="text" name="note" placeholder="note (optional)" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs mb-1" />
        <button type="submit" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Request"}
        </button>
      </div>
      {msg && <span className={`sm:col-span-6 text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>}
    </form>
  );
}
