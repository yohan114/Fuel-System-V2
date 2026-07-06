"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, X, Check } from "lucide-react";
import { createLubricantAction, updateLubricantAction, deleteLubricantAction } from "@/app/actions/lubricants";
import { OIL_SLOTS } from "@/lib/service/sheet";

export interface LubeRow {
  id: string;
  name: string;
  oilType: string | null;
  unit: string;
  pricePerUnitCents: number | null;
  note: string | null;
  active: boolean;
}

const inputCls = "bg-[#1b1e30] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-cyan-500/50 outline-none";
function rs(cents: number | null) {
  return cents == null ? "—" : "Rs " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LubricantManager({ rows }: { rows: LubeRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<any>, ok: string, after?: () => void) {
    setBusy(key);
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setMsg({ ok: false, text: res.error });
      else { setMsg({ ok: true, text: ok }); after?.(); router.refresh(); }
      setBusy(null);
    });
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`text-xs rounded-lg px-3 py-2 ${msg.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{msg.text}</div>
      )}

      {/* Add form */}
      <form
        className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end"
        action={(fd) => run("create", () => createLubricantAction(fd), "Lubricant added", () => {
          (document.getElementById("lube-add") as HTMLFormElement)?.reset();
        })}
        id="lube-add"
      >
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Grade / Product *</label>
          <input name="name" required placeholder="e.g. CJ4 15W40" className={inputCls + " w-full"} />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Oil type</label>
          <input name="oilType" list="oil-slots" placeholder="Engine Oil" className={inputCls + " w-full"} />
          <datalist id="oil-slots">{OIL_SLOTS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Unit</label>
          <select name="unit" defaultValue="L" className={inputCls + " w-full"}>
            <option value="L">L</option>
            <option value="kg">kg</option>
            <option value="unit">unit</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Price / unit (LKR)</label>
          <input name="price" type="number" step="0.01" min="0" placeholder="0.00" className={inputCls + " w-full"} />
        </div>
        <button type="submit" disabled={pending} className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-3 py-2 flex items-center justify-center gap-1.5">
          {busy === "create" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
        </button>
      </form>

      {/* Table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-white/5">
              <th className="px-4 py-2.5 font-semibold">Grade / Product</th>
              <th className="px-3 py-2.5 font-semibold">Oil type</th>
              <th className="px-3 py-2.5 font-semibold">Unit</th>
              <th className="px-3 py-2.5 font-semibold text-right">Price / unit</th>
              <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600">No lubricants yet — add your oils and greases above.</td></tr>
            )}
            {rows.map((r) => editId === r.id ? (
              <tr key={r.id} className="border-b border-white/5 bg-white/[0.02]">
                <td colSpan={5} className="px-3 py-3">
                  <form
                    className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end"
                    action={(fd) => run("edit-" + r.id, () => updateLubricantAction(r.id, fd), "Lubricant updated", () => setEditId(null))}
                  >
                    <input name="name" required defaultValue={r.name} className={inputCls + " w-full col-span-2"} />
                    <input name="oilType" list="oil-slots-e" defaultValue={r.oilType ?? ""} placeholder="Oil type" className={inputCls + " w-full"} />
                    <datalist id="oil-slots-e">{OIL_SLOTS.map((s) => <option key={s} value={s} />)}</datalist>
                    <select name="unit" defaultValue={r.unit} className={inputCls + " w-full"}>
                      <option value="L">L</option><option value="kg">kg</option><option value="unit">unit</option>
                    </select>
                    <input name="price" type="number" step="0.01" min="0" defaultValue={r.pricePerUnitCents != null ? (r.pricePerUnitCents / 100).toString() : ""} placeholder="Price" className={inputCls + " w-full"} />
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <input type="checkbox" name="active" defaultChecked={r.active} className="accent-cyan-500" /> Active
                    </label>
                    <div className="flex gap-1.5">
                      <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                        {busy === "edit-" + r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button type="button" onClick={() => setEditId(null)} className="bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg px-2.5 py-1.5"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className={`border-b border-white/5 ${r.active ? "" : "opacity-40"}`}>
                <td className="px-4 py-2.5 text-white font-medium">{r.name}{!r.active && <span className="ml-2 text-[10px] text-gray-500">(inactive)</span>}</td>
                <td className="px-3 py-2.5 text-gray-400">{r.oilType ?? "—"}</td>
                <td className="px-3 py-2.5 text-gray-400">{r.unit}</td>
                <td className="px-3 py-2.5 text-right text-gray-200 font-mono">{rs(r.pricePerUnitCents)}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => { setEditId(r.id); setMsg(null); }} className="text-gray-400 hover:text-cyan-400 p-1"><Pencil className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => { if (confirm(`Delete lubricant "${r.name}"?`)) run("del-" + r.id, () => deleteLubricantAction(r.id), "Lubricant deleted"); }}
                      className="text-gray-400 hover:text-rose-400 p-1"
                    >{busy === "del-" + r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
