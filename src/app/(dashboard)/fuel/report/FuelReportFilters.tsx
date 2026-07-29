"use client";

import React from "react";
import { Search, FileDown, FileSpreadsheet, Filter } from "lucide-react";
import { FUEL_KINDS } from "@/lib/fuel-kinds";

interface Option {
  id: string;
  label: string;
}

interface Props {
  sites: Option[];
  vehicles: string[];
  /** Locked to their own site — a site user cannot widen the scope. */
  siteLocked: boolean;
  current: {
    from: string;
    to: string;
    site: string;
    vehicle: string;
    fuelKind: string;
  };
  /** Query string for the export routes, already carrying the active filters. */
  exportQuery: string;
}

export default function FuelReportFilters({ sites, vehicles, siteLocked, current, exportQuery }: Props) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg space-y-4">
      <form method="GET" action="/fuel/report" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">From</label>
          <input
            type="date"
            name="from"
            defaultValue={current.from}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">To</label>
          <input
            type="date"
            name="to"
            defaultValue={current.to}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Site</label>
          <select
            name="site"
            defaultValue={current.site}
            disabled={siteLocked}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Vehicle</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              name="vehicle"
              list="fuel-report-vehicles"
              defaultValue={current.vehicle}
              placeholder="Code or reg no…"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-8 pr-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            />
            <datalist id="fuel-report-vehicles">
              {vehicles.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Fuel</label>
          <select
            name="fuelKind"
            defaultValue={current.fuelKind}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">All fuels</option>
            {FUEL_KINDS.map((k) => (
              <option key={k.code} value={k.code}>
                {k.short}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2 lg:col-span-5 flex flex-wrap gap-3 pt-1">
          <button
            type="submit"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
          >
            <Filter className="w-3.5 h-3.5" />
            Apply Filters
          </button>

          {/* Plain links, not fetch(): the browser handles the file download and
              the routes re-run the same query, so a download always matches the
              table above it. */}
          <a
            href={`/api/fuel-report/pdf${exportQuery}`}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/5 text-gray-200 font-semibold text-xs px-5 py-2.5 rounded-xl active:scale-95 transition-all"
          >
            <FileDown className="w-3.5 h-3.5 text-rose-400" />
            Download PDF
          </a>

          <a
            href={`/api/fuel-report/xlsx${exportQuery}`}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/5 text-gray-200 font-semibold text-xs px-5 py-2.5 rounded-xl active:scale-95 transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            Download Excel
          </a>
        </div>
      </form>
    </div>
  );
}
