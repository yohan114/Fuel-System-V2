"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { logDetailedServiceAction, type DetailedServiceInput } from "@/app/actions/service";
import type { ServiceRates } from "@/lib/service/defaults";

export interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  brand: string | null;
  model: string | null;
  meterType: string;
}
interface OilLine {
  name: string;
  unit: string;
  unitPriceCents: number;
}
interface FilterLine {
  name: string;
  unitPriceCents: number;
}

interface PriceData {
  filterPrices: { code: string; cents: number }[];
  oilPrices: { code: string; cents: number }[];
}

interface Props {
  assets: AssetOption[];
  oilLines: OilLine[];
  filterLines: FilterLine[];
  rates: ServiceRates;
  priceData: PriceData;
  defaultAssetCode?: string;
}

interface OilRow {
  type: string;
  action: string;
  qty: string;
  price: string;
}
interface FilterRow {
  no: string;
  qty: string;
  action: string;
  price: string;
}
interface CostRow {
  desc: string;
  unit: string;
  rate: string;
  qty: string;
  amount: string;
}

const COST_ROWS = 5;

const inputCls = "bg-[#121420] border border-white/5 rounded-lg px-2.5 py-1.5 text-white text-xs w-full focus:outline-none focus:border-indigo-500/40";

function toCents(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
function fmtRs(cents: number): string {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function DetailedServiceForm({ assets, oilLines, filterLines, rates, priceData, defaultAssetCode }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [assetRef, setAssetRef] = useState(defaultAssetCode ?? "");
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [jobNo, setJobNo] = useState("");
  const [meter, setMeter] = useState("");
  const [nextMeter, setNextMeter] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [site, setSite] = useState("");
  const [upkeep, setUpkeep] = useState("");
  const [repair, setRepair] = useState("");
  const [note, setNote] = useState("");

  const [oils, setOils] = useState<OilRow[]>(() => oilLines.map(() => ({ type: "", action: "", qty: "", price: "" })));
  const [filters, setFilters] = useState<FilterRow[]>(() => filterLines.map(() => ({ no: "", qty: "1", action: "", price: "" })));
  const [costs, setCosts] = useState<CostRow[]>(() =>
    Array.from({ length: COST_ROWS }, () => ({ desc: "", unit: "", rate: "", qty: "", amount: "" }))
  );

  const matchedAsset = useMemo(() => {
    const ref = assetRef.trim().toUpperCase();
    return assets.find((a) => a.code.toUpperCase() === ref || a.id === assetRef.trim()) ?? null;
  }, [assetRef, assets]);
  const meterUnit = matchedAsset ? (matchedAsset.meterType === "KM" ? "km" : "hr") : "";

  // Live totals — mirrors computeServiceTotals on the server.
  const totals = useMemo(() => {
    const parts =
      oils.reduce((s, o) => s + toCents(o.price), 0) +
      filters.reduce((s, f) => s + toCents(f.price), 0) +
      costs.reduce((s, c) => s + toCents(c.amount), 0);
    const labourRatePct = parts > rates.labourThresholdCents ? rates.labourRateHigh : rates.labourRateLow;
    const labourChargeCents = Math.round((parts * labourRatePct) / 100);
    const sundryAmountCents = Math.round((parts * rates.sundryRate) / 100);
    return {
      partsSubtotalCents: parts,
      labourRatePct,
      labourChargeCents,
      sundryRatePct: rates.sundryRate,
      sundryAmountCents,
      grandTotalCents: parts + labourChargeCents + sundryAmountCents,
    };
  }, [oils, filters, costs, rates]);

  // Price-book lookup maps for auto-fill (mirrors the Service Record form):
  // a chosen oil grade or filter part number fills the price = unit × qty.
  const oilPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of priceData.oilPrices) m.set(o.code.toUpperCase().trim(), o.cents);
    return m;
  }, [priceData]);
  const filterPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of priceData.filterPrices) {
      m.set(f.code.toUpperCase().trim(), f.cents);
      m.set(normCode(f.code), f.cents);
    }
    return m;
  }, [priceData]);

  function lookupOilCents(grade: string): number {
    const k = grade.toUpperCase().trim();
    if (!k) return 0;
    if (oilPriceMap.has(k)) return oilPriceMap.get(k)!;
    for (const [code, c] of oilPriceMap) if (code.includes(k) || k.includes(code)) return c;
    return 0;
  }
  function lookupFilterCents(no: string): number {
    const k = no.toUpperCase().trim();
    if (!k) return 0;
    if (filterPriceMap.has(k)) return filterPriceMap.get(k)!;
    const nk = normCode(no);
    if (nk && filterPriceMap.has(nk)) return filterPriceMap.get(nk)!;
    for (const [code, c] of filterPriceMap) if (code.includes(k) || (nk && code.includes(nk))) return c;
    return 0;
  }

  function updateOil(i: number, patch: Partial<OilRow>) {
    setOils((prev) => {
      const next = [...prev];
      const row = { ...next[i], ...patch };
      if ("qty" in patch || "type" in patch) {
        const unit = lookupOilCents(row.type) || oilLines[i].unitPriceCents || 0;
        const q = parseFloat(row.qty);
        if (unit > 0 && Number.isFinite(q) && q > 0) row.price = ((unit * q) / 100).toFixed(2);
      }
      next[i] = row;
      return next;
    });
  }
  function updateFilter(i: number, patch: Partial<FilterRow>) {
    setFilters((prev) => {
      const next = [...prev];
      const row = { ...next[i], ...patch };
      if ("qty" in patch || "no" in patch) {
        const unit = lookupFilterCents(row.no) || filterLines[i].unitPriceCents || 0;
        const q = parseFloat(row.qty) || 1;
        if (unit > 0) row.price = ((unit * q) / 100).toFixed(2);
      }
      next[i] = row;
      return next;
    });
  }
  function updateCost(i: number, patch: Partial<CostRow>) {
    setCosts((prev) => {
      const next = [...prev];
      const row = { ...next[i], ...patch };
      if ("rate" in patch || "qty" in patch) {
        const r = parseFloat(row.rate);
        const q = parseFloat(row.qty);
        if (Number.isFinite(r) && Number.isFinite(q) && r > 0 && q > 0) row.amount = (r * q).toFixed(2);
      }
      next[i] = row;
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetRef.trim()) return setError("Pick a vehicle.");
    if (!serviceDate) return setError("Pick a service date.");

    const payload: DetailedServiceInput = {
      assetRef: assetRef.trim(),
      serviceDate,
      jobNo: jobNo.trim() || undefined,
      meterAtService: meter.trim() ? parseFloat(meter) : null,
      nextServiceMeter: nextMeter.trim() ? parseFloat(nextMeter) : null,
      serviceType: serviceType.trim() || undefined,
      siteLocation: site.trim() || undefined,
      upkeepingStatus: upkeep || undefined,
      repairDetails: repair.trim() || undefined,
      note: note.trim() || undefined,
      oils: oils.map((o, i) => ({
        name: oilLines[i].name,
        type: o.type,
        action: o.action,
        quantity: parseFloat(o.qty) || 0,
        priceLkr: parseFloat(o.price) || 0,
      })),
      filters: filters.map((f, i) => ({
        category: filterLines[i].name,
        no: f.no,
        action: f.action,
        quantity: parseFloat(f.qty) || 1,
        priceLkr: parseFloat(f.price) || 0,
      })),
      costs: costs.map((c) => ({
        description: c.desc,
        unit: c.unit,
        rateLkr: parseFloat(c.rate) || 0,
        qty: parseFloat(c.qty) || 0,
        amountLkr: parseFloat(c.amount) || 0,
      })),
    };

    startTransition(async () => {
      const res = await logDetailedServiceAction(payload);
      if (res?.error) setError(res.error);
      else router.push(res?.id ? `/service/records/${res.id}` : "/service/records");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-xs rounded-xl px-4 py-3">{error}</div>
      )}

      <datalist id="oil-grades">
        {priceData.oilPrices.map((o) => (
          <option key={o.code} value={o.code} />
        ))}
      </datalist>
      <datalist id="filter-codes">
        {priceData.filterPrices.slice(0, 1000).map((f, i) => (
          <option key={`${f.code}-${i}`} value={f.code} />
        ))}
      </datalist>

      {/* Header */}
      <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5 space-y-4">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider">Service Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Vehicle (E&amp;C code)</span>
            <input
              list="asset-options"
              value={assetRef}
              onChange={(e) => setAssetRef(e.target.value)}
              placeholder="e.g. DT-123"
              className={inputCls}
              required
            />
            <datalist id="asset-options">
              {assets.map((a) => (
                <option key={a.id} value={a.code}>
                  {[a.brand, a.model].filter(Boolean).join(" ")} {a.regNo ? `· ${a.regNo}` : ""}
                </option>
              ))}
            </datalist>
            <span className="text-[10px] text-gray-500 mt-1 block h-3">
              {matchedAsset
                ? `${[matchedAsset.brand, matchedAsset.model].filter(Boolean).join(" ")}${matchedAsset.regNo ? ` · ${matchedAsset.regNo}` : ""}`
                : assetRef.trim()
                  ? "No exact match — check the code"
                  : ""}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Service date</span>
            <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={inputCls} required />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Job no.</span>
            <input value={jobNo} onChange={(e) => setJobNo(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Meter at service {meterUnit && `(${meterUnit})`}</span>
            <input type="number" step="0.1" value={meter} onChange={(e) => setMeter(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Next service meter</span>
            <input type="number" step="0.1" value={nextMeter} onChange={(e) => setNextMeter(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Service type</span>
            <input value={serviceType} onChange={(e) => setServiceType(e.target.value)} placeholder="e.g. 500HR / Oil change" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Site / location</span>
            <input value={site} onChange={(e) => setSite(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">Upkeeping status</span>
            <select value={upkeep} onChange={(e) => setUpkeep(e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="GOOD">Good</option>
              <option value="NEEDS_REPAIR">Needs repair</option>
              <option value="UNDER_REPAIR">Under repair</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase block mb-1">Repair details</span>
          <textarea value={repair} onChange={(e) => setRepair(e.target.value)} rows={2} className={inputCls} />
        </label>
      </div>

      {/* Oils + Filters */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Matrix title="Oils">
          <thead>
            <tr className="text-gray-500 text-[10px] uppercase">
              <th className="text-left font-semibold pb-2">Oil</th>
              <th className="text-left font-semibold pb-2">Grade / type</th>
              <th className="text-left font-semibold pb-2 w-12">C/V</th>
              <th className="text-right font-semibold pb-2 w-16">Qty</th>
              <th className="text-right font-semibold pb-2 w-24">Price (Rs)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {oilLines.map((o, i) => (
              <tr key={o.name}>
                <td className="py-1.5 pr-2 text-gray-300 text-xs whitespace-nowrap">{o.name}</td>
                <td className="py-1.5 pr-2"><input list="oil-grades" value={oils[i].type} onChange={(e) => updateOil(i, { type: e.target.value })} className={inputCls} /></td>
                <td className="py-1.5 pr-2"><input value={oils[i].action} onChange={(e) => updateOil(i, { action: e.target.value.toUpperCase() })} className={inputCls} /></td>
                <td className="py-1.5 pr-2"><input type="number" step="0.1" value={oils[i].qty} onChange={(e) => updateOil(i, { qty: e.target.value })} className={`${inputCls} text-right`} /></td>
                <td className="py-1.5"><input type="number" step="0.01" value={oils[i].price} onChange={(e) => updateOil(i, { price: e.target.value })} className={`${inputCls} text-right`} /></td>
              </tr>
            ))}
          </tbody>
        </Matrix>

        <Matrix title="Filters">
          <thead>
            <tr className="text-gray-500 text-[10px] uppercase">
              <th className="text-left font-semibold pb-2">Filter</th>
              <th className="text-left font-semibold pb-2">Part no.</th>
              <th className="text-right font-semibold pb-2 w-14">Qty</th>
              <th className="text-left font-semibold pb-2 w-12">X/E</th>
              <th className="text-right font-semibold pb-2 w-24">Price (Rs)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filterLines.map((f, i) => (
              <tr key={f.name}>
                <td className="py-1.5 pr-2 text-gray-300 text-xs whitespace-nowrap">{f.name}</td>
                <td className="py-1.5 pr-2"><input list="filter-codes" value={filters[i].no} onChange={(e) => updateFilter(i, { no: e.target.value })} className={inputCls} /></td>
                <td className="py-1.5 pr-2"><input type="number" min="1" value={filters[i].qty} onChange={(e) => updateFilter(i, { qty: e.target.value })} className={`${inputCls} text-right`} /></td>
                <td className="py-1.5 pr-2"><input value={filters[i].action} onChange={(e) => updateFilter(i, { action: e.target.value.toUpperCase() })} className={inputCls} /></td>
                <td className="py-1.5"><input type="number" step="0.01" value={filters[i].price} onChange={(e) => updateFilter(i, { price: e.target.value })} className={`${inputCls} text-right`} /></td>
              </tr>
            ))}
          </tbody>
        </Matrix>
      </div>

      {/* Other costs */}
      <Matrix title="Other costs">
        <thead>
          <tr className="text-gray-500 text-[10px] uppercase">
            <th className="text-left font-semibold pb-2">Description</th>
            <th className="text-left font-semibold pb-2 w-20">Unit</th>
            <th className="text-right font-semibold pb-2 w-24">Rate (Rs)</th>
            <th className="text-right font-semibold pb-2 w-16">Qty</th>
            <th className="text-right font-semibold pb-2 w-28">Amount (Rs)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {costs.map((c, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-2"><input value={c.desc} onChange={(e) => updateCost(i, { desc: e.target.value })} className={inputCls} /></td>
              <td className="py-1.5 pr-2"><input value={c.unit} onChange={(e) => updateCost(i, { unit: e.target.value })} className={inputCls} /></td>
              <td className="py-1.5 pr-2"><input type="number" step="0.01" value={c.rate} onChange={(e) => updateCost(i, { rate: e.target.value })} className={`${inputCls} text-right`} /></td>
              <td className="py-1.5 pr-2"><input type="number" step="0.1" value={c.qty} onChange={(e) => updateCost(i, { qty: e.target.value })} className={`${inputCls} text-right`} /></td>
              <td className="py-1.5"><input type="number" step="0.01" value={c.amount} onChange={(e) => updateCost(i, { amount: e.target.value })} className={`${inputCls} text-right`} /></td>
            </tr>
          ))}
        </tbody>
      </Matrix>

      {/* Totals + actions */}
      <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
          <Total label="Parts" value={fmtRs(totals.partsSubtotalCents)} />
          <Total label={`Labour (${totals.labourRatePct}%)`} value={fmtRs(totals.labourChargeCents)} />
          <Total label={`Sundry (${totals.sundryRatePct}%)`} value={fmtRs(totals.sundryAmountCents)} />
          <Total label="Grand total" value={fmtRs(totals.grandTotalCents)} highlight />
        </div>
        <div className="flex items-center gap-3">
          <Link href="/service/records" className="text-xs font-semibold text-gray-400 hover:text-white px-4 py-2">Cancel</Link>
          <button
            type="submit"
            disabled={isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg px-5 py-2.5"
          >
            {isPending ? "Saving…" : "Save service"}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-gray-500">
        Labour is {rates.labourRateLow}% of parts up to Rs {(rates.labourThresholdCents / 100).toLocaleString("en-LK")} and {rates.labourRateHigh}% above it; sundry is {rates.sundryRate}% of parts. Totals are recalculated on the server when you save.
      </p>
    </form>
  );
}

function Matrix({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5">
      <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">{children}</table>
      </div>
    </div>
  );
}

function Total({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? "bg-indigo-500/10 border-indigo-500/20" : "bg-[#121420] border-white/5"}`}>
      <span className="text-[10px] text-gray-500 uppercase block">{label}</span>
      <span className={`font-bold block mt-0.5 ${highlight ? "text-indigo-300 text-sm" : "text-white text-xs"}`}>{value}</span>
    </div>
  );
}
