"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, CheckCircle2, XCircle, Lock, AlertTriangle, SkipForward } from "lucide-react";
import { generateBillsForMonthAction } from "@/app/actions/billing";

interface Props {
  defaultYear: number;
  defaultMonth: number;
}

type AssetStatus = "created" | "regenerated" | "skipped-existing" | "skipped-finalized" | "no-rate" | "error";

interface AssetOutcome {
  assetId: string;
  assetCode: string;
  assetLabel?: string;
  status: AssetStatus;
  message?: string;
  billId?: string;
}

const STATUS_META: Record<AssetStatus, { icon: React.ReactNode; label: string; cls: string }> = {
  created:           { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Created",   cls: "text-emerald-400" },
  regenerated:       { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Regenerated", cls: "text-indigo-400" },
  "skipped-existing":   { icon: <SkipForward className="w-3.5 h-3.5" />,   label: "Existing",   cls: "text-gray-400" },
  "skipped-finalized":  { icon: <Lock className="w-3.5 h-3.5" />,          label: "Locked",     cls: "text-amber-400" },
  "no-rate":         { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "No rate",  cls: "text-orange-400" },
  error:             { icon: <XCircle className="w-3.5 h-3.5" />,       label: "Error",    cls: "text-red-400" },
};

export default function GenerateBillsPanel({ defaultYear, defaultMonth }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [regenerate, setRegenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetOutcome[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function run() {
    setError(null);
    setAssets(null);
    setSummary(null);
    const fd = new FormData();
    fd.set("year", String(year));
    fd.set("month", String(month));
    if (regenerate) fd.set("regenerate", "true");
    startTransition(async () => {
      const res = await generateBillsForMonthAction(fd);
      if ((res as any).error) {
        setError((res as any).error);
      } else {
        const r = (res as any).result;
        setAssets(r.assets ?? []);
        setSummary(`${r.periodKey}: ${r.created} created, ${r.regenerated} regenerated, ${r.skippedExisting} existing, ${r.skippedFinalized} locked, ${r.noRate} no rate${r.errors?.length ? `, ${r.errors.length} errors` : ""}.`);
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-400" />
        Generate Monthly Bills
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300 select-none pb-2.5">
          <input
            type="checkbox"
            checked={regenerate}
            onChange={(e) => setRegenerate(e.target.checked)}
            className="accent-indigo-500 w-4 h-4"
          />
          Regenerate drafts
        </label>
        <button
          onClick={run}
          disabled={pending}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {pending ? "Generating…" : "Generate"}
        </button>
      </div>

      {error && (
        <div className="text-xs rounded-xl px-4 py-3 border bg-red-500/10 text-red-300 border-red-500/10">
          {error}
        </div>
      )}

      {pending && (
        <div className="text-xs text-gray-400 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> Processing vehicles…
        </div>
      )}

      {assets && assets.length > 0 && (
        <div className="space-y-2">
          {summary && (
            <p className="text-[11px] text-gray-400 font-semibold">{summary}</p>
          )}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/5 divide-y divide-white/5">
            {assets.map((a) => {
              const meta = STATUS_META[a.status];
              return (
                <div key={a.assetId} className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02]">
                  <span className={meta.cls}>{meta.icon}</span>
                  <span className="text-white font-mono font-semibold w-20 shrink-0">{a.assetCode}</span>
                  <span className="text-gray-400 truncate flex-1">{a.assetLabel}</span>
                  <span className={`font-semibold shrink-0 ${meta.cls}`}>{meta.label}</span>
                  {a.message && <span className="text-red-400 text-[10px] truncate max-w-[120px]">{a.message}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-500">
        Regenerate refreshes <span className="text-gray-400">draft</span> bills only — issued / paid invoices are locked.
      </p>
    </div>
  );
}
