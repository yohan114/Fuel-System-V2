"use client";

import React, { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createHiredAssetAction, markAssetHiredAction, updateHireAction, endHireAction,
} from "@/app/actions/hire";
import {
  Handshake, Plus, Pencil, X, RefreshCw, AlertTriangle, CheckCircle, LogOut, Truck,
} from "lucide-react";

interface CategoryOpt { id: string; code: string; name: string; defaultMeterType: string; }
interface OwnedOpt { id: string; code: string; categoryCode: string; }
interface HiredRow {
  id: string; code: string; categoryCode: string; categoryName: string; meterType: string;
  supplier: string | null; rateCents: number | null; basis: string | null;
  start: string | null; end: string | null; note: string | null; site: string | null;
}
interface Props { hired: HiredRow[]; categories: CategoryOpt[]; ownedAssets: OwnedOpt[]; }

const BASIS_LABEL: Record<string, string> = { hour: "/ hr", day: "/ day", month: "/ month" };

function rate(cents: number | null, basis: string | null) {
  if (cents == null) return <span className="text-gray-600">—</span>;
  return (
    <span className="tabular-nums">
      Rs {(cents / 100).toLocaleString("en-LK")}{" "}
      <span className="text-gray-500 text-[10px]">{basis ? BASIS_LABEL[basis] : ""}</span>
    </span>
  );
}

const inputCls =
  "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500/50";
const labelCls = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5";

export default function HireManager({ hired, categories, ownedAssets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [meterType, setMeterType] = useState(categories[0]?.defaultMeterType ?? "HOURS");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addOk, setAddOk] = useState(false);
  const [editing, setEditing] = useState<HiredRow | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  const codeToId = useMemo(() => new Map(ownedAssets.map((a) => [a.code.toUpperCase(), a.id])), [ownedAssets]);

  const onCatChange = (id: string) => {
    setCatId(id);
    const c = categories.find((x) => x.id === id);
    if (c) setMeterType(c.defaultMeterType);
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddErr(null); setAddOk(false);
    const form = e.currentTarget;
    const fd = new FormData(form);

    startTransition(async () => {
      let res;
      if (mode === "new") {
        res = await createHiredAssetAction(fd);
      } else {
        const code = fd.get("existingCode")?.toString().trim().toUpperCase() || "";
        const id = codeToId.get(code);
        if (!id) { setAddErr(`No owned asset with code "${code}"`); return; }
        res = await markAssetHiredAction(id, fd);
      }
      if (res?.error) { setAddErr(res.error); }
      else {
        setAddOk(true);
        form.reset();
        setCatId(categories[0]?.id ?? "");
        setMeterType(categories[0]?.defaultMeterType ?? "HOURS");
        router.refresh();
        setTimeout(() => setAddOk(false), 2500);
      }
    });
  };

  const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setEditErr(null);
    const fd = new FormData(e.currentTarget);
    const id = editing.id;
    startTransition(async () => {
      const res = await updateHireAction(id, fd);
      if (res?.error) setEditErr(res.error);
      else { setEditing(null); router.refresh(); }
    });
  };

  const handleEndHire = (row: HiredRow) => {
    if (!confirm(`Take ${row.code} off-hire? It stays in the fleet as a returned machine but leaves this list.`)) return;
    startTransition(async () => {
      const res = await endHireAction(row.id);
      if (res?.error) alert(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-7">
      {/* Add / convert */}
      <div className="bg-white/5 border border-white/5 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Add a hired machine</h3>
        </div>

        <div className="inline-flex rounded-xl border border-white/10 p-1 mb-5 bg-[#141626]">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setAddErr(null); setAddOk(false); }}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                mode === m ? "bg-amber-500/90 text-black" : "text-gray-400 hover:text-white"
              }`}
            >
              {m === "new" ? "New machine" : "Existing asset"}
            </button>
          ))}
        </div>

        <form onSubmit={handleAdd} className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {mode === "new" ? (
            <>
              <div>
                <label className={labelCls}>Machine code *</label>
                <input name="code" required placeholder="e.g. D4D-01" className={`${inputCls} font-mono uppercase`} />
              </div>
              <div>
                <label className={labelCls}>Category *</label>
                <select name="categoryId" required value={catId} onChange={(e) => onCatChange(e.target.value)} className={inputCls}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Meter</label>
                <select name="meterType" value={meterType} onChange={(e) => setMeterType(e.target.value)} className={inputCls}>
                  <option value="HOURS">Hours</option>
                  <option value="KM">Kilometres</option>
                </select>
              </div>
            </>
          ) : (
            <div className="col-span-2 md:col-span-3">
              <label className={labelCls}>Existing owned asset *</label>
              <input
                name="existingCode"
                required
                list="owned-codes"
                placeholder="Type or pick an asset code…"
                className={`${inputCls} font-mono uppercase max-w-xs`}
              />
              <datalist id="owned-codes">
                {ownedAssets.map((a) => (
                  <option key={a.id} value={a.code}>{a.categoryCode}</option>
                ))}
              </datalist>
              <p className="text-[10px] text-gray-500 mt-1.5">Flags an already-registered machine as hired without creating a duplicate.</p>
            </div>
          )}

          <div>
            <label className={labelCls}>Hired from (supplier)</label>
            <input name="hireSupplier" placeholder="Owner / supplier name" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hire rate (Rs)</label>
            <input name="hireRate" type="number" step="0.01" min="0" placeholder="0.00" className={`${inputCls} tabular-nums`} />
          </div>
          <div>
            <label className={labelCls}>Rate basis</label>
            <select name="hireRateBasis" defaultValue="month" className={inputCls}>
              <option value="month">Per month</option>
              <option value="day">Per day</option>
              <option value="hour">Per hour</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Hire start</label>
            <input name="hireStart" type="date" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hire end (optional)</label>
            <input name="hireEnd" type="date" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Note</label>
            <input name="hireNote" placeholder="Agreement ref, terms…" className={inputCls} />
          </div>

          <div className="col-span-2 md:col-span-3 flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isPending}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              {isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {mode === "new" ? "Add hired machine" : "Mark as hired"}
            </button>
            {addErr && (
              <span className="text-[11px] text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{addErr}</span>
            )}
            {addOk && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" />Saved to the hire fleet.</span>
            )}
          </div>
        </form>
      </div>

      {/* Hired fleet table */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-3">
          <Truck className="w-4 h-4 text-amber-400" />
          Hired fleet ({hired.length})
        </h3>
        {hired.length === 0 ? (
          <div className="border border-dashed border-white/10 rounded-2xl py-12 text-center text-xs text-gray-500">
            No hired machines yet. Add one above.
          </div>
        ) : (
          <div className="border border-white/5 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
                  <th className="px-5 py-3">Machine</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Hired from</th>
                  <th className="px-5 py-3">Hire rate</th>
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {hired.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-bold text-white">{r.code}</span>
                      <span className="block text-[10px] text-gray-500">{r.meterType === "KM" ? "km" : "hrs"}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-300">
                      <span className="text-[9px] font-bold bg-white/5 border border-white/5 rounded px-1.5 py-0.5 text-gray-400">{r.categoryCode}</span>
                      <span className="block text-gray-500 mt-0.5">{r.categoryName}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-300">{r.supplier || <span className="text-gray-600">—</span>}</td>
                    <td className="px-5 py-3.5 text-white">{rate(r.rateCents, r.basis)}</td>
                    <td className="px-5 py-3.5 text-gray-400 tabular-nums">
                      {r.start || "—"}{r.end ? ` → ${r.end}` : r.start ? " → ongoing" : ""}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400">{r.site || <span className="text-gray-600">—</span>}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => { setEditing(r); setEditErr(null); }}
                          className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold hover:underline"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => handleEndHire(r)}
                          className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 font-bold hover:underline"
                        >
                          <LogOut className="w-3 h-3" /> End hire
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative">
            <button onClick={() => setEditing(null)} className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Handshake className="w-5 h-5 text-amber-400" /> Hire terms · <span className="font-mono">{editing.code}</span>
            </h3>

            {editErr && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{editErr}</span>
              </div>
            )}

            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className={labelCls}>Hired from (supplier)</label>
                <input name="hireSupplier" defaultValue={editing.supplier ?? ""} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Hire rate (Rs)</label>
                  <input name="hireRate" type="number" step="0.01" min="0" defaultValue={editing.rateCents != null ? editing.rateCents / 100 : ""} className={`${inputCls} tabular-nums`} />
                </div>
                <div>
                  <label className={labelCls}>Rate basis</label>
                  <select name="hireRateBasis" defaultValue={editing.basis ?? "month"} className={inputCls}>
                    <option value="month">Per month</option>
                    <option value="day">Per day</option>
                    <option value="hour">Per hour</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Hire start</label>
                  <input name="hireStart" type="date" defaultValue={editing.start ?? ""} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Hire end</label>
                  <input name="hireEnd" type="date" defaultValue={editing.end ?? ""} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Note</label>
                <input name="hireNote" defaultValue={editing.note ?? ""} className={inputCls} />
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Save hire terms
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
