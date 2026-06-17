"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface RunningPoint {
  date: string;
  actual?: number | null;
  standard?: number | null;
  econ?: number | null;
}
interface FuelPoint {
  date: string;
  litres: number;
}

interface Props {
  mode: string; // "hourly" | "perkm" | "perday"
  unit: string; // "hr" | "km" | "day"
  readingsData: RunningPoint[];
  fuelData: FuelPoint[];
  derived?: boolean; // running curve was derived from fuel (no meter readings)
}

export default function BillingRunningChart({ mode, unit, readingsData, fuelData, derived }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-72 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
        <div className="h-72 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const baseTitle =
    mode === "perkm" ? "Monthly Running (KM)" : mode === "perday" ? "Daily Hours Logged" : "Monthly Running (Hours)";
  const runningTitle = derived ? `${baseTitle} — Fuel-Derived` : baseTitle;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 1. Running curve within the month */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          {runningTitle}
        </h3>
        <div className="h-60 w-full">
          {readingsData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500 text-center px-4">
              {mode === "perday"
                ? "Per-day billing uses working-day logs; no meter curve."
                : "No meter readings logged for this month."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={readingsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} ${unit}`, String(name)]}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual (Meter)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "#10b981" }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="standard"
                  name="Standard Fuel-Derived"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={{ r: 2, fill: "#f59e0b" }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="econ"
                  name="Economy Fuel-Derived"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={{ r: 2, fill: "#8b5cf6" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. Fuel quantity issued */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          Fuel Quantity Issued (L)
        </h3>
        <div className="h-60 w-full">
          {fuelData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              No fuel issued this month.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fuelData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)} Litres`, "Volume"]}
                />
                <Bar dataKey="litres" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
