"use client";

import React, { useState } from "react";
import { recordStockCountAction } from "@/app/actions/inventory";

interface Props {
  productId: string;
  period: string;
  name: string;
  unit: string;
  bookQty: number;
  countedQty: number | null;
  variance: number | null;
  adjusted: boolean;
}

// One product's stock-take line: enter the physical count, optionally post an
// adjustment so the book matches reality.
export default function StockTakeRow(props: Props) {
  const [counted, setCounted] = useState(props.countedQty == null ? "" : String(props.countedQty));
  const [adjust, setAdjust] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ variance: number; adjusted: boolean } | null>(
    props.countedQty == null ? null : { variance: props.variance ?? 0, adjusted: props.adjusted },
  );
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.set("productId", props.productId);
    fd.set("period", props.period);
    fd.set("countedQty", counted);
    fd.set("postAdjustment", adjust ? "true" : "false");
    const res = await recordStockCountAction(fd);
    setPending(false);
    if (res?.error) setErr(res.error);
    else setResult({ variance: res?.variance ?? 0, adjusted: !!res?.adjusted });
  }

  const v = result?.variance ?? null;
  const vCls = v == null ? "text-gray-500" : Math.abs(v) < 0.001 ? "text-emerald-400" : "text-amber-400";

  return (
    <tr className="hover:bg-white/[0.01]">
      <td className="py-3 font-semibold text-white">{props.name}</td>
      <td className="py-3 text-right text-gray-300">{props.bookQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-gray-500">{props.unit}</span></td>
      <td className="py-3 text-right">
        <input
          type="number" step="0.01" min={0} value={counted}
          onChange={(e) => setCounted(e.target.value)}
          className="w-24 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1 text-white text-xs text-right"
        />
      </td>
      <td className={`py-3 text-right font-semibold ${vCls}`}>
        {v == null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        {result?.adjusted && <span className="ml-1 text-[9px] text-emerald-400">(adjusted)</span>}
      </td>
      <td className="py-3 text-center">
        <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
          <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} /> adjust
        </label>
      </td>
      <td className="py-3 text-right">
        <button onClick={save} disabled={pending || counted === ""} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold text-xs rounded-lg px-3 py-1.5">
          {pending ? "…" : "Save"}
        </button>
        {err && <span className="block text-[9px] text-red-400 mt-1">{err}</span>}
      </td>
    </tr>
  );
}
