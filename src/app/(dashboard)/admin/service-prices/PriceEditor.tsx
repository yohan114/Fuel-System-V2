"use client";

import React, { useState, useTransition } from "react";
import { updateServicePriceAction, type PriceKind } from "@/app/actions/pricebook";
import { Check } from "lucide-react";

export interface PriceRow {
  id: string;
  label: string;
  sub?: string;
  cents: number;
}

export default function PriceEditor({ kind, rows }: { kind: PriceKind; rows: PriceRow[] }) {
  if (rows.length === 0) {
    return <div className="text-center py-6 text-xs text-gray-500">No items.</div>;
  }
  return (
    <div className="divide-y divide-white/5">
      {rows.map((r) => (
        <Row key={r.id} kind={kind} row={r} />
      ))}
    </div>
  );
}

function Row({ kind, row }: { kind: PriceKind; row: PriceRow }) {
  const [value, setValue] = useState((row.cents / 100).toFixed(2));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = Math.round(parseFloat(value) * 100) !== row.cents;

  function save() {
    setError(null);
    const lkr = parseFloat(value);
    if (!Number.isFinite(lkr) || lkr < 0) return setError("Invalid");
    startTransition(async () => {
      const res = await updateServicePriceAction({ kind, id: row.id, unitLkr: lkr });
      if (res?.error) setError(res.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-200 block truncate">{row.label}</span>
        {row.sub && <span className="text-[10px] text-gray-500 block truncate">{row.sub}</span>}
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-gray-500">Rs.</span>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-28 bg-[#121420] border border-white/5 rounded-lg px-2.5 py-1.5 text-white text-xs text-right focus:outline-none focus:border-indigo-500/40"
        />
        <button
          onClick={save}
          disabled={isPending || !dirty}
          className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${
            saved ? "bg-emerald-600 text-white" : dirty ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-white/5 text-gray-500"
          } disabled:opacity-60`}
        >
          {saved ? <Check className="w-3.5 h-3.5" /> : isPending ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
