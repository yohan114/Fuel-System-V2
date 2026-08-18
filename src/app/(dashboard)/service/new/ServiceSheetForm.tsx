"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Loader2, Paperclip, Save, Droplets, Filter as FilterIcon } from "lucide-react";
import { computeServiceCost, lineAmountCents } from "@/lib/service/cost";
import { OIL_SLOTS, FILTER_SLOTS, OIL_ACTIONS, FILTER_ACTIONS, CONDITIONS } from "@/lib/service/sheet";
import { logServiceSheetAction } from "@/app/actions/service";

export interface AssetOpt { code: string; regNo: string | null; model: string | null; meterType: string }
export interface LubeOpt { name: string; oilType: string | null; unit: string; pricePerUnitCents: number | null }
export interface FilterOpt { partNo: string; category: string | null; priceCents: number | null }

// One fixed chart row per sheet slot — mirrors the paper form exactly.
interface OilRow { type: string; action: string; qty: string; price: string }
interface FilterRow { partNo: string; action: string; qty: string; price: string }
interface ManLine { label: string; unit: string; qty: string; unitPriceCents: string }

const input = "bg-[#1b1e30] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:border-cyan-500/50 outline-none";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toCents = (lkr: string) => { const n = parseFloat(lkr); return isNaN(n) ? 0 : Math.round(n * 100); };

// Keyword relevance: which catalogue filters belong to a sheet slot.
const SLOT_KEYWORDS: [RegExp, RegExp][] = [
  [/AIR DRYER/i, /DRYER/i],
  [/AIR BREATHER/i, /BREATHER/i],
  [/AIR/i, /AIR/i],
  [/WATER SEP|SEDIMENT|FUEL/i, /FUEL|WATER|SEP/i],
  [/HYDRAULIC|LINE/i, /HYD|LINE/i],
  [/TRANS/i, /TRANS/i],
  [/COOLANT/i, /COOL/i],
  [/STEERING/i, /STEER/i],
  [/OIL/i, /OIL|LUBE/i],
];
function relevantFilters(slot: string, all: FilterOpt[]): FilterOpt[] {
  for (const [slotRe, catRe] of SLOT_KEYWORDS) {
    if (slotRe.test(slot)) {
      const hit = all.filter((f) => catRe.test(f.category || ""));
      if (hit.length > 0) return hit;
      break;
    }
  }
  return [];
}

export default function ServiceSheetForm({ assets, lubricants, filters, labourPct, sundryPct, presetCode }:
  { assets: AssetOpt[]; lubricants: LubeOpt[]; filters: FilterOpt[]; labourPct: number; sundryPct: number; presetCode?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [assetCode, setAssetCode] = useState(presetCode ?? "");
  const asset = useMemo(() => assets.find((a) => a.code.toUpperCase() === assetCode.toUpperCase()) || null, [assetCode, assets]);

  const [oils, setOils] = useState<OilRow[]>(OIL_SLOTS.map(() => ({ type: "", action: "", qty: "", price: "" })));
  const [filts, setFilts] = useState<FilterRow[]>(FILTER_SLOTS.map(() => ({ partNo: "", action: "", qty: "1", price: "" })));
  const [mans, setMans] = useState<ManLine[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const lubeByName = useMemo(() => new Map(lubricants.map((l) => [l.name, l])), [lubricants]);
  const filterByPN = useMemo(() => new Map(filters.map((f) => [f.partNo, f])), [filters]);

  // A chart row counts only once something is entered on it.
  const oilUsed = (r: OilRow) => !!(r.type || r.action || parseFloat(r.qty) > 0);
  const filterUsed = (r: FilterRow) => !!(r.partNo || r.action || toCents(r.price) > 0);

  const cost = useMemo(() => computeServiceCost([
    ...oils.filter(oilUsed).map((r) => ({ kind: "OIL" as const, amountCents: lineAmountCents(parseFloat(r.qty) || 0, toCents(r.price)) })),
    ...filts.filter(filterUsed).map((r) => ({ kind: "FILTER" as const, amountCents: lineAmountCents(parseFloat(r.qty) || 1, toCents(r.price)) })),
    ...mans.map((l) => ({ kind: "MANPOWER" as const, amountCents: lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)) })),
  ], { labourPct, sundryPct }), [oils, filts, mans, labourPct, sundryPct]);

  function submit(fd: FormData) {
    setErr(null);
    if (!assetCode.trim()) { setErr("Pick a vehicle (E&C code)"); return; }
    fd.set("assetId", assetCode.trim());
    fd.set("oilLines", JSON.stringify(oils.map((r, i) => ({ ...r, slot: OIL_SLOTS[i] })).filter(oilUsed)
      .map((r) => ({ slot: r.slot, label: r.type, action: r.action, qty: parseFloat(r.qty) || 0, unitPriceCents: toCents(r.price) }))));
    fd.set("filterLines", JSON.stringify(filts.map((r, i) => ({ ...r, slot: FILTER_SLOTS[i] })).filter(filterUsed)
      .map((r) => ({ slot: r.slot, partNo: r.partNo, action: r.action, qty: parseFloat(r.qty) || 1, unitPriceCents: toCents(r.price) }))));
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
  const th = "px-1.5 py-1.5 font-semibold text-left";

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

      {/* Oils — full chart, one row per sheet slot */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2"><Droplets className="w-3.5 h-3.5 text-cyan-400" /> Lubricants <span className="text-gray-600 normal-case font-normal">C = Change · V = Topped up</span></h3>
          {lubricants.length === 0 && (
            <Link href="/lubricants" className="text-[11px] text-amber-400 hover:text-amber-300">No oils stored yet — add types &amp; prices in Lubricants →</Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className={th}>Oil name</th><th className={th}>Type (grade)</th><th className={th + " w-16"}>C/V</th>
              <th className={th + " w-20"}>Litres</th><th className={th + " w-24"}>Rate/L</th><th className={th + " text-right w-28"}>Amount</th>
            </tr></thead>
            <tbody>
              {OIL_SLOTS.map((slot, i) => {
                const r = oils[i];
                const used = oilUsed(r);
                const matching = lubricants.filter((l) => l.oilType === slot);
                const rest = lubricants.filter((l) => l.oilType !== slot);
                return (
                  <tr key={slot} className={`border-t border-white/5 ${used ? "bg-cyan-500/[0.04]" : ""}`}>
                    <td className={`px-1.5 py-1 whitespace-nowrap ${used ? "text-cyan-200 font-semibold" : "text-gray-400"}`}>{slot}</td>
                    <td className="p-1">
                      <select value={r.type} onChange={(e) => {
                        const g = lubeByName.get(e.target.value);
                        setOils(upd(oils, i, { type: e.target.value, price: g?.pricePerUnitCents != null ? (g.pricePerUnitCents / 100).toString() : r.price }));
                      }} className={input + " w-full min-w-36"}>
                        <option value="">—</option>
                        {matching.length > 0 && <optgroup label={slot}>{matching.map((l) => <option key={l.name} value={l.name}>{l.name}{l.pricePerUnitCents != null ? ` — Rs ${(l.pricePerUnitCents / 100).toLocaleString("en-LK")}/${l.unit}` : ""}</option>)}</optgroup>}
                        {rest.length > 0 && <optgroup label="All grades">{rest.map((l) => <option key={l.name} value={l.name}>{l.name}{l.pricePerUnitCents != null ? ` — Rs ${(l.pricePerUnitCents / 100).toLocaleString("en-LK")}/${l.unit}` : ""}</option>)}</optgroup>}
                      </select>
                    </td>
                    <td className="p-1">
                      <select value={r.action} onChange={(e) => setOils(upd(oils, i, { action: e.target.value }))} className={input + " w-full"}>
                        <option value="">—</option>
                        {OIL_ACTIONS.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
                      </select>
                    </td>
                    <td className="p-1"><input type="number" step="0.1" min="0" value={r.qty} onChange={(e) => setOils(upd(oils, i, { qty: e.target.value }))} className={input + " w-full"} /></td>
                    <td className="p-1"><input type="number" step="0.01" min="0" value={r.price} onChange={(e) => setOils(upd(oils, i, { price: e.target.value }))} placeholder="auto" className={input + " w-full"} /></td>
                    <td className="px-1.5 py-1 text-right font-mono text-gray-300 whitespace-nowrap">{used ? rs(lineAmountCents(parseFloat(r.qty) || 0, toCents(r.price))) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters — full chart, one row per sheet slot */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2"><FilterIcon className="w-3.5 h-3.5 text-indigo-400" /> Filters <span className="text-gray-600 normal-case font-normal">X = Replaced · E = Cleaned</span></h3>
          {filters.length === 0 && (
            <Link href="/filters" className="text-[11px] text-amber-400 hover:text-amber-300">No filter prices stored yet — add them in Filter Database →</Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className={th}>Filter</th><th className={th}>Filter no.</th><th className={th + " w-16"}>X/E</th>
              <th className={th + " w-16"}>Qty</th><th className={th + " w-24"}>Price</th><th className={th + " text-right w-28"}>Amount</th>
            </tr></thead>
            <tbody>
              {FILTER_SLOTS.map((slot, i) => {
                const r = filts[i];
                const used = filterUsed(r);
                const matching = relevantFilters(slot, filters);
                const rest = filters.filter((f) => !matching.includes(f));
                return (
                  <tr key={slot} className={`border-t border-white/5 ${used ? "bg-indigo-500/[0.05]" : ""}`}>
                    <td className={`px-1.5 py-1 whitespace-nowrap ${used ? "text-indigo-200 font-semibold" : "text-gray-400"}`}>{slot}</td>
                    <td className="p-1">
                      {filters.length > 0 ? (
                        <select value={r.partNo} onChange={(e) => {
                          const f = filterByPN.get(e.target.value);
                          setFilts(upd(filts, i, { partNo: e.target.value, price: f?.priceCents != null ? (f.priceCents / 100).toString() : r.price }));
                        }} className={input + " w-full min-w-36"}>
                          <option value="">—</option>
                          {matching.length > 0 && <optgroup label="Matching">{matching.map((f) => <option key={f.partNo} value={f.partNo}>{f.partNo}{f.priceCents != null ? ` — Rs ${(f.priceCents / 100).toLocaleString("en-LK")}` : ""}</option>)}</optgroup>}
                          <optgroup label={matching.length > 0 ? "All filters" : "Filters"}>{rest.map((f) => <option key={f.partNo} value={f.partNo}>{f.partNo}{f.priceCents != null ? ` — Rs ${(f.priceCents / 100).toLocaleString("en-LK")}` : ""}</option>)}</optgroup>
                        </select>
                      ) : (
                        <input value={r.partNo} onChange={(e) => setFilts(upd(filts, i, { partNo: e.target.value }))} placeholder="part no" className={input + " w-full"} />
                      )}
                    </td>
                    <td className="p-1">
                      <select value={r.action} onChange={(e) => setFilts(upd(filts, i, { action: e.target.value }))} className={input + " w-full"}>
                        <option value="">—</option>
                        {FILTER_ACTIONS.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
                      </select>
                    </td>
                    <td className="p-1"><input type="number" step="1" min="0" value={r.qty} onChange={(e) => setFilts(upd(filts, i, { qty: e.target.value }))} className={input + " w-full"} /></td>
                    <td className="p-1"><input type="number" step="0.01" min="0" value={r.price} onChange={(e) => setFilts(upd(filts, i, { price: e.target.value }))} placeholder="auto" className={input + " w-full"} /></td>
                    <td className="px-1.5 py-1 text-right font-mono text-gray-300 whitespace-nowrap">{used ? rs(lineAmountCents(parseFloat(r.qty) || 1, toCents(r.price))) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manpower / other — free lines like the bottom table of the sheet */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Manpower / other</h3>
          <button type="button" onClick={() => setMans((v) => [...v, { label: "", unit: "", qty: "1", unitPriceCents: "" }])} className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Add cost line</button>
        </div>
        {mans.length === 0 ? <p className="text-xs text-gray-600 text-center py-2">No lines — add one above.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className={th}>Description</th><th className={th + " w-20"}>Unit</th><th className={th + " w-16"}>Qty</th><th className={th + " w-24"}>Rate</th><th className={th + " text-right w-28"}>Amount</th><th className="w-8" /></tr></thead>
            <tbody>
              {mans.map((l, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="p-1"><input value={l.label} onChange={(e) => setMans(upd(mans, i, { label: e.target.value }))} placeholder="Labour / sundry item" className={input + " w-full"} /></td>
                  <td className="p-1"><input value={l.unit} onChange={(e) => setMans(upd(mans, i, { unit: e.target.value }))} className={input + " w-full"} /></td>
                  <td className="p-1"><input type="number" step="0.1" min="0" value={l.qty} onChange={(e) => setMans(upd(mans, i, { qty: e.target.value }))} className={input + " w-full"} /></td>
                  <td className="p-1"><input type="number" step="0.01" min="0" value={l.unitPriceCents} onChange={(e) => setMans(upd(mans, i, { unitPriceCents: e.target.value }))} className={input + " w-full"} /></td>
                  <td className="px-1.5 py-1 text-right font-mono text-gray-300 whitespace-nowrap">{rs(lineAmountCents(parseFloat(l.qty) || 1, toCents(l.unitPriceCents)))}</td>
                  <td className="p-1"><button type="button" onClick={() => setMans(mans.filter((_, j) => j !== i))} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
