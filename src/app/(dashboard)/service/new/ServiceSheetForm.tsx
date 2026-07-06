"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Paperclip, Save } from "lucide-react";
import { computeServiceCost, lineAmountCents } from "@/lib/service/cost";
import { OIL_SLOTS, FILTER_SLOTS, OIL_ACTIONS, FILTER_ACTIONS, CONDITIONS } from "@/lib/service/sheet";
import { logServiceSheetAction } from "@/app/actions/service";

export interface AssetOpt { code: string; regNo: string | null; model: string | null; meterType: string }
export interface LubeOpt { name: string; oilType: string | null; unit: string; pricePerUnitCents: number | null }
export interface FilterOpt { partNo: string; priceCents: number | null }

interface OilLine { slot: string; label: string; action: string; qty: string; unitPriceCents: string }
interface FilterLine { slot: string; partNo: string; action: string; qty: string; unitPriceCents: string }
interface ManLine { label: string; unit: string; qty: string; unitPriceCents: string }

const input = "bg-[#1b1e30] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-cyan-500/50 outline-none";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toCents = (lkr: string) => { const n = parseFloat(lkr); return isNaN(n) ? 0 : Math.round(n * 100); };

export default function ServiceSheetForm({ assets, lubricants, filters, labourPct, sundryPct, presetCode }:
  { assets: AssetOpt[]; lubricants: LubeOpt[]; filters: FilterOpt[]; labourPct: number; sundryPct: number; presetCode?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [assetCode, setAssetCode] = useState(presetCode ?? "");
  const asset = useMemo(() => assets.find((a) => a.code.toUpperCase() === assetCode.toUpperCase()) || null, [assetCode, assets]);

  const [oils, setOils] = useState<OilLine[]>([{ slot: "Engine Oil", label: "", action: "C", qty: "", unitPriceCents: "" }]);
  const [filts, setFilts] = useState<FilterLine[]>([{ slot: "Engine Oil Filter", partNo: "", action: "X", qty: "1", unitPriceCents: "" }]);
  const [mans, setMans] = useState<ManLine[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const priceByPartNo = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of filters) if (f.priceCents != null) m.set(f.partNo.toUpperCase().replace(/[\s\-\/]/g, ""), f.priceCents);
    return m;
  }, [filters]);

  // Live cost breakdown.
  const cost = useMemo(() => {
    const items = [
      ...oils.map((l) => ({ kind: "OIL" as const, amountCents: lineAmountCents(parseFloat(l.qty) || 0, toCents(l.unitPriceCents)) })),
      ...filts.map((l) => ({ kind: "FILTER" as const, amountCents: lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)) })),
      ...mans.map((l) => ({ kind: "MANPOWER" as const, amountCents: lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)) })),
    ];
    return computeServiceCost(items, { labourPct, sundryPct });
  }, [oils, filts, mans, labourPct, sundryPct]);

  function submit(fd: FormData) {
    setErr(null);
    if (!assetCode.trim()) { setErr("Pick a vehicle (E&C code)"); return; }
    fd.set("assetId", assetCode.trim());
    fd.set("oilLines", JSON.stringify(oils.map((l) => ({ slot: l.slot, label: l.label, action: l.action, qty: parseFloat(l.qty) || 0, unitPriceCents: toCents(l.unitPriceCents) }))));
    fd.set("filterLines", JSON.stringify(filts.map((l) => ({ slot: l.slot, partNo: l.partNo, action: l.action, qty: parseFloat(l.qty) || 1, unitPriceCents: toCents(l.unitPriceCents) }))));
    fd.set("manpowerLines", JSON.stringify(mans.map((l) => ({ label: l.label, unit: l.unit, qty: parseFloat(l.qty) || 1, unitPriceCents: toCents(l.unitPriceCents) }))));
    fd.delete("attachments");
    for (const f of files) fd.append("attachments", f);
    startTransition(async () => {
      const res = await logServiceSheetAction(fd);
      if (res?.error) setErr(res.error);
      else if (res?.id) router.push(`/service/record/${res.id}`);
    });
  }

  const card = "bg-[#121420] border border-white/5 rounded-2xl p-4";
  const label = "block text-[10px] uppercase tracking-wider text-gray-500 mb-1";

  return (
    <form action={submit} className="space-y-5">
      {err && <div className="bg-rose-500/10 text-rose-400 text-xs rounded-lg px-3 py-2">{err}</div>}

      {/* Header */}
      <div className={card}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={label}>E&amp;C Code *</label>
            <input list="asset-codes" value={assetCode} onChange={(e) => setAssetCode(e.target.value)} placeholder="e.g. DT-11" className={input + " w-full"} />
            <datalist id="asset-codes">{assets.map((a) => <option key={a.code} value={a.code}>{a.regNo || ""} {a.model || ""}</option>)}</datalist>
          </div>
          <div><label className={label}>Reg ID</label><input value={asset?.regNo ?? ""} readOnly className={input + " w-full opacity-70"} placeholder="—" /></div>
          <div><label className={label}>Model</label><input value={asset?.model ?? ""} readOnly className={input + " w-full opacity-70"} placeholder="—" /></div>
          <div><label className={label}>Date *</label><input name="serviceDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={input + " w-full"} /></div>
          <div><label className={label}>Job / Service No</label><input name="jobNo" className={input + " w-full"} /></div>
          <div><label className={label}>Meter reading ({asset?.meterType ?? "KM"})</label><input name="meterAtService" type="number" step="0.1" min="0" className={input + " w-full"} /></div>
          <div><label className={label}>Next service at</label><input name="nextServiceMeter" type="number" step="0.1" min="0" className={input + " w-full"} /></div>
          <div><label className={label}>Service type</label><input name="serviceType" placeholder="e.g. 18,000 km" className={input + " w-full"} /></div>
          <div><label className={label}>Location (site)</label><input name="location" placeholder="e.g. Badalgama W/S" className={input + " w-full"} /></div>
          <div>
            <label className={label}>Condition</label>
            <select name="condition" defaultValue="" className={input + " w-full"}>
              <option value="">—</option>
              {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Oil lines */}
      <LineTable
        title="Lubricants" addLabel="Add oil line"
        onAdd={() => setOils((v) => [...v, { slot: "", label: "", action: "C", qty: "", unitPriceCents: "" }])}
        head={["Oil name", "Grade / product", "C/V", "Litres", "Rate/L", "Amount", ""]}
        rows={oils.map((l, i) => (
          <>
            <td className="p-1"><input list="oil-slots" value={l.slot} onChange={(e) => setOils(upd(oils, i, { slot: e.target.value }))} className={input + " w-full"} /></td>
            <td className="p-1">
              <input list="lube-grades" value={l.label} onChange={(e) => {
                const g = lubricants.find((x) => x.name.toUpperCase() === e.target.value.toUpperCase());
                setOils(upd(oils, i, { label: e.target.value, ...(g?.pricePerUnitCents != null ? { unitPriceCents: (g.pricePerUnitCents / 100).toString() } : {}) }));
              }} className={input + " w-full"} />
            </td>
            <td className="p-1"><select value={l.action} onChange={(e) => setOils(upd(oils, i, { action: e.target.value }))} className={input + " w-full"}>{OIL_ACTIONS.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
            <td className="p-1"><input type="number" step="0.1" min="0" value={l.qty} onChange={(e) => setOils(upd(oils, i, { qty: e.target.value }))} className={input + " w-20"} /></td>
            <td className="p-1"><input type="number" step="0.01" min="0" value={l.unitPriceCents} onChange={(e) => setOils(upd(oils, i, { unitPriceCents: e.target.value }))} className={input + " w-24"} /></td>
            <td className="p-1 text-right text-gray-300 font-mono whitespace-nowrap">{rs(lineAmountCents(parseFloat(l.qty) || 0, toCents(l.unitPriceCents)))}</td>
            <td className="p-1"><button type="button" onClick={() => setOils(oils.filter((_, j) => j !== i))} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
          </>
        ))}
      />
      <datalist id="oil-slots">{OIL_SLOTS.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="lube-grades">{lubricants.map((l, i) => <option key={i} value={l.name}>{l.oilType || ""}</option>)}</datalist>

      {/* Filter lines */}
      <LineTable
        title="Filters" addLabel="Add filter line"
        onAdd={() => setFilts((v) => [...v, { slot: "", partNo: "", action: "X", qty: "1", unitPriceCents: "" }])}
        head={["Filter", "Filter no.", "X/E", "Qty", "Rate", "Amount", ""]}
        rows={filts.map((l, i) => (
          <>
            <td className="p-1"><input list="filter-slots" value={l.slot} onChange={(e) => setFilts(upd(filts, i, { slot: e.target.value }))} className={input + " w-full"} /></td>
            <td className="p-1"><input value={l.partNo} onChange={(e) => {
              const key = e.target.value.toUpperCase().replace(/[\s\-\/]/g, "");
              const p = priceByPartNo.get(key);
              setFilts(upd(filts, i, { partNo: e.target.value, ...(p != null ? { unitPriceCents: (p / 100).toString() } : {}) }));
            }} className={input + " w-full"} /></td>
            <td className="p-1"><select value={l.action} onChange={(e) => setFilts(upd(filts, i, { action: e.target.value }))} className={input + " w-full"}>{FILTER_ACTIONS.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></td>
            <td className="p-1"><input type="number" step="1" min="0" value={l.qty} onChange={(e) => setFilts(upd(filts, i, { qty: e.target.value }))} className={input + " w-16"} /></td>
            <td className="p-1"><input type="number" step="0.01" min="0" value={l.unitPriceCents} onChange={(e) => setFilts(upd(filts, i, { unitPriceCents: e.target.value }))} className={input + " w-24"} /></td>
            <td className="p-1 text-right text-gray-300 font-mono whitespace-nowrap">{rs(lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)))}</td>
            <td className="p-1"><button type="button" onClick={() => setFilts(filts.filter((_, j) => j !== i))} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
          </>
        ))}
      />
      <datalist id="filter-slots">{FILTER_SLOTS.map((s) => <option key={s} value={s} />)}</datalist>

      {/* Manpower / other lines */}
      <LineTable
        title="Manpower / other" addLabel="Add cost line"
        onAdd={() => setMans((v) => [...v, { label: "", unit: "", qty: "1", unitPriceCents: "" }])}
        head={["Description", "Unit", "Qty", "Rate", "Amount", ""]}
        rows={mans.map((l, i) => (
          <>
            <td className="p-1"><input value={l.label} onChange={(e) => setMans(upd(mans, i, { label: e.target.value }))} placeholder="Labour / sundry item" className={input + " w-full"} /></td>
            <td className="p-1"><input value={l.unit} onChange={(e) => setMans(upd(mans, i, { unit: e.target.value }))} className={input + " w-20"} /></td>
            <td className="p-1"><input type="number" step="0.1" min="0" value={l.qty} onChange={(e) => setMans(upd(mans, i, { qty: e.target.value }))} className={input + " w-16"} /></td>
            <td className="p-1"><input type="number" step="0.01" min="0" value={l.unitPriceCents} onChange={(e) => setMans(upd(mans, i, { unitPriceCents: e.target.value }))} className={input + " w-24"} /></td>
            <td className="p-1 text-right text-gray-300 font-mono whitespace-nowrap">{rs(lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)))}</td>
            <td className="p-1"><button type="button" onClick={() => setMans(mans.filter((_, j) => j !== i))} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
          </>
        ))}
      />

      {/* Attachments + note */}
      <div className={card + " space-y-3"}>
        <div>
          <label className={label}><Paperclip className="w-3 h-3 inline mr-1" />Attach scanned sheet / photos</label>
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} className="text-xs text-gray-400 file:bg-white/5 file:border-0 file:text-gray-200 file:rounded-lg file:px-3 file:py-1.5 file:mr-3 file:text-xs" />
          {files.length > 0 && <span className="text-[11px] text-cyan-400 ml-2">{files.length} file(s)</span>}
        </div>
        <div><label className={label}>Note</label><textarea name="note" rows={2} className={input + " w-full"} /></div>
      </div>

      {/* Cost summary */}
      <div className={card}>
        <div className="max-w-sm ml-auto space-y-1.5 text-xs">
          <Row k="Lubricants" v={rs(cost.lubricantCents)} />
          <Row k="Filters" v={rs(cost.filterCents)} />
          <Row k="Parts subtotal" v={rs(cost.partsCents)} bold />
          <Row k="Manpower / other" v={rs(cost.manpowerCents)} />
          <Row k={`Labour charge (${(labourPct * 100).toFixed(0)}% of parts)`} v={rs(cost.labourCents)} />
          <Row k={`Sundry (${(sundryPct * 100).toFixed(0)}% of parts)`} v={rs(cost.sundryCents)} />
          <div className="flex items-center justify-between border-t border-white/10 pt-2 mt-1">
            <span className="text-cyan-300 font-bold uppercase tracking-wider text-[11px]">Total</span>
            <span className="text-cyan-300 font-bold text-sm font-mono">{rs(cost.totalCents)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl px-6 py-2.5 flex items-center gap-2">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save service
        </button>
      </div>
    </form>
  );
}

function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "text-gray-200 font-semibold" : "text-gray-400"}>{k}</span>
      <span className={`font-mono ${bold ? "text-white font-semibold" : "text-gray-300"}`}>{v}</span>
    </div>
  );
}

function LineTable({ title, addLabel, onAdd, head, rows }: { title: string; addLabel: string; onAdd: () => void; head: string[]; rows: React.ReactNode[] }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h3>
        <button type="button" onClick={onAdd} className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{addLabel}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-500">{head.map((h, i) => <th key={i} className={`px-1 py-1 font-semibold ${i >= head.length - 2 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={head.length} className="px-1 py-3 text-gray-600 text-center">No lines — add one above.</td></tr>}
            {rows.map((r, i) => <tr key={i} className="border-t border-white/5">{r}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
