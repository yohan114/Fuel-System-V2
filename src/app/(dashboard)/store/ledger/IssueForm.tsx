"use client";

import React, { useState } from "react";
import { issueStockAction } from "@/app/actions/inventory";

interface ProductOpt { id: string; name: string; unit: string }
interface ProjectOpt { id: string; name: string; sites: { id: string; name: string }[] }

// Issue stock to a consumer. The store keeper either types a machine's E&C code
// or picks a project (and optional site). The server enforces the over-issue
// guard and records an unmatched description in the Mapping queue.
export default function IssueForm({ products, projects }: { products: ProductOpt[]; projects: ProjectOpt[] }) {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState("");

  const sites = projects.find((p) => p.id === projectId)?.sites ?? [];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await issueStockAction(new FormData(form));
    setPending(false);
    if (res?.error) setMsg({ type: "err", text: res.error });
    else {
      setMsg({ type: "ok", text: `Issued — balance now ${res?.balanceAfter ?? "updated"}.` });
      form.reset();
      setProjectId("");
    }
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
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Qty issued</label>
        <input type="number" step="0.01" min={0} name="qty" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Machine (E&amp;C code)</label>
        <input type="text" name="assetCode" placeholder="e.g. HEX-12" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs font-mono uppercase" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">…or Project</label>
        <select name="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">—</option>
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
      <div className="sm:col-span-5">
        <input type="text" name="description" placeholder="description / remark (used for mapping if no machine/project picked)" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <button type="submit" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Issue"}
        </button>
      </div>
      {msg && <span className={`sm:col-span-6 text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>}
    </form>
  );
}
