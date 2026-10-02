"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Fuel,
  Wrench,
  Activity,
  AlertTriangle,
  Clock,
  Calendar,
  Filter,
} from "lucide-react";

export interface TimelineEvent {
  id: string;
  type: "FUEL" | "SERVICE" | "READING" | "CONDITION";
  date: Date;
  title: string;
  detail: string;
  badge?: string;
  value?: string;
  href?: string;
}

interface AssetHistoryTimelineProps {
  assetCode: string;
  events: TimelineEvent[];
}

export function AssetHistoryTimeline({ assetCode, events }: AssetHistoryTimelineProps) {
  const [filterType, setFilterType] = useState<string>("ALL");

  const filtered = events.filter((e) => filterType === "ALL" || e.type === filterType);

  const typeConfig = {
    FUEL: { icon: Fuel, color: "text-amber-400", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    SERVICE: { icon: Wrench, color: "text-cyan-400", badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
    READING: { icon: Activity, color: "text-indigo-400", badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
    CONDITION: { icon: AlertTriangle, color: "text-rose-400", badge: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href={`/fleet/${assetCode}`}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Back to {assetCode}
          </Link>
          <h1 className="text-xl font-bold text-white tracking-wide">
            Operational Timeline: {assetCode}
          </h1>
          <p className="text-xs text-gray-400">
            Unified chronological history of fuel disbursements, meter readings, breakdowns, and maintenance sheets.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1.5 flex-wrap">
          {["ALL", "FUEL", "SERVICE", "READING", "CONDITION"].map((ft) => (
            <button
              key={ft}
              onClick={() => setFilterType(ft)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filterType === ft
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {ft}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500">
            No history events recorded matching this filter.
          </div>
        ) : (
          <div className="relative pl-6 border-l border-white/10 space-y-8 my-2">
            {filtered.map((item) => {
              const cfg = typeConfig[item.type] || typeConfig.FUEL;
              const Icon = cfg.icon;
              return (
                <div key={item.id} className="relative group">
                  {/* Dot */}
                  <div className="absolute -left-[31px] top-0.5 w-4 h-4 rounded-full bg-[#121420] border-2 border-indigo-500 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.badge}`}>
                          {item.type}
                        </span>
                        <span className="text-xs font-bold text-white">{item.title}</span>
                      </div>
                      <p className="text-xs text-gray-400">{item.detail}</p>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                      <span className="text-[11px] text-gray-500 font-mono">
                        {new Date(item.date).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {item.value && (
                        <span className="text-xs font-bold text-white">{item.value}</span>
                      )}
                      {item.href && (
                        <Link
                          href={item.href}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                        >
                          View Details →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
