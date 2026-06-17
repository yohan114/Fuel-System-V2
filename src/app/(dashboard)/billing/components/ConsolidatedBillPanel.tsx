"use client";

import React, { useState } from "react";
import { FileText, FileSpreadsheet } from "lucide-react";

interface Props {
  defaultYear: number;
  defaultMonth: number;
  sites?: { code: string; name: string }[];
}

export default function ConsolidatedBillPanel({ defaultYear, defaultMonth, sites = [] }: Props) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [site, setSite] = useState("all");

  const siteParam = site !== "all" ? `&site=${encodeURIComponent(site)}` : "";
  const pdfHref = `/api/billing/consolidated/pdf?year=${year}&month=${month}${siteParam}`;
  const xlsxHref = `/api/billing/consolidated/xlsx?year=${year}&month=${month}${siteParam}`;

  return (
    <div className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <FileText className="w-4 h-4 text-amber-400" />
        Consolidated Vehicle Bill
      </h3>
      <p className="text-[11px] text-gray-400">
        Generate one combined statement <span className="text-white">grouped by site</span> for the selected month — each site gets its own section with per-vehicle breakdown and a site subtotal, followed by an overall grand total. Choose a single site to bill that site only.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500/50"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Site</label>
          <select
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500/50"
          >
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 flex gap-3">
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
          >
            <FileText className="w-4 h-4" />
            PDF
          </a>
          <a
            href={xlsxHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </a>
        </div>
      </div>
      <p className="text-[10px] text-gray-500">
        Bills for the matching year / month are included regardless of status, grouped by site.
      </p>
    </div>
  );
}
