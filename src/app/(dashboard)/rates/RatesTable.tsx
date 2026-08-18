"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { RateBandRow } from "@/lib/consumption/rates-overview";

interface Props {
  rows: RateBandRow[];
  canEdit: boolean;
}

type Filter = "all" | "over" | "measured" | "no-band" | "conflict" | "no-card";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "over", label: "Over standard" },
  { key: "measured", label: "Measured" },
  { key: "no-band", label: "No band" },
  { key: "conflict", label: "Not comparable" },
  { key: "no-card", label: "No rate card" },
];

const STATE_STYLE: Record<string, { cls: string; label: string }> = {
  OVER: { cls: "bg-rose-500/10 text-rose-400 border-rose-500/30", label: "over heavy" },
  HEAVY: { cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", label: "above standard" },
  NORMAL: { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", label: "within band" },
  BELOW_ECON: { cls: "bg-sky-500/10 text-sky-400 border-sky-500/30", label: "below econ" },
};

const REASON_LABEL: Record<string, string> = {
  "no-rate-card": "no rate card",
  "no-band": "no band set",
  "basis-conflict": "not comparable — hour band on a km meter",
};

export default function RatesTable({ rows, canEdit }: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "over" && r.state !== "OVER" && r.state !== "HEAVY") return false;
      if (filter === "measured" && r.intervals === 0) return false;
      if (filter === "no-band" && r.bandReason !== "no-band") return false;
      if (filter === "conflict" && r.bandReason !== "basis-conflict") return false;
      if (filter === "no-card" && r.bandReason !== "no-rate-card") return false;
      if (!term) return true;
      return (
        r.code.toLowerCase().includes(term) ||
        (r.regNo ?? "").toLowerCase().includes(term) ||
        (r.categoryName ?? "").toLowerCase().includes(term) ||
        (r.projectName ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, filter]);

  const num = (n: number | null, dp = 1) => (n == null ? "—" : n.toFixed(dp));

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search machine, plate, category or site…"
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[10px] font-semibold px-3 py-1.5 rounded-lg border transition ${
                filter === f.key
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-[#1b1e30] border-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-2 text-[10px] text-gray-500 border-b border-white/5">
        {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} machines
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#0d0f1a] text-gray-500">
            <tr>
              <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Machine</th>
              <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Category</th>
              <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Econ</th>
              <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Standard</th>
              <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Heavy</th>
              <th className="text-left font-semibold uppercase tracking-wider px-2 py-3">Unit</th>
              <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Actual</th>
              <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Intervals</th>
              <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.map((r) => {
              const st = r.state ? STATE_STYLE[r.state] : null;
              return (
                <tr key={r.assetId} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/fleet/${encodeURIComponent(r.code)}`} className="text-white font-semibold hover:text-indigo-400">
                      {r.code}
                    </Link>
                    {r.regNo ? <span className="text-gray-600 ml-2">{r.regNo}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-gray-400">{r.categoryName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right text-gray-300 tabular-nums">{num(r.econDisplay)}</td>
                  <td className="px-3 py-2.5 text-right text-white font-semibold tabular-nums">{num(r.typDisplay)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-300 tabular-nums">{num(r.heavyDisplay)}</td>
                  <td className="px-2 py-2.5 text-gray-600">{r.typ != null ? r.unit : "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${r.actualDisplay != null ? "text-white" : "text-gray-600"}`}>
                    {num(r.actualDisplay)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums">{r.intervals || "—"}</td>
                  <td className="px-4 py-2.5">
                    {st ? (
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${st.cls}`}>
                        {st.label}
                        {r.severity > 0 ? ` · ${r.severity.toFixed(2)}×` : ""}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-600">
                        {REASON_LABEL[r.bandReason] ??
                          (r.intervals > 0 ? `${r.intervals} interval — need 3` : "not measured")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-gray-500">No machines match that filter.</div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="px-4 py-3 border-t border-white/5 text-[10px] text-gray-500">
          Bands are edited on each machine&apos;s page, under Fuel Consumption. Changes are recorded in the audit log.
        </div>
      ) : null}
    </div>
  );
}
