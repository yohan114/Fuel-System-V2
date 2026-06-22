"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

interface MonthPoint { month: string; label: string; cents: number; count: number }
interface CatPoint { name: string; cents: number; count: number }

const fmtLkr = (cents: number) => `Rs. ${(cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const compact = (cents: number) => `Rs.${(cents / 100).toLocaleString("en-LK", { notation: "compact" })}`;

export default function ServiceCostCharts({ byMonth, byCategory }: { byMonth: MonthPoint[]; byCategory: CatPoint[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-80 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
        <div className="h-80 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const cats = byCategory.slice(0, 10);
  const palette = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Monthly spend trend */}
      <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
        <h3 className="text-md font-bold text-white tracking-wide">Monthly Service Spend</h3>
        <p className="text-xs text-gray-400 mb-6">Grand-total service cost recorded per month</p>
        <div className="h-72 w-full">
          {byMonth.every((m) => m.cents === 0) ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">No service spend in this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="label" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={compact} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "12px", fontWeight: "bold" }}
                  formatter={(value: any, _name: any, p: any) => [`${fmtLkr(value)} · ${p?.payload?.count ?? 0} services`, "Spend"]}
                />
                <Bar dataKey="cents" name="Spend" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* By category */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
        <h3 className="text-md font-bold text-white tracking-wide">Spend by Category</h3>
        <p className="text-xs text-gray-400 mb-6">Top categories by service cost</p>
        <div className="h-72 w-full">
          {cats.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <XAxis type="number" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={compact} />
                <YAxis type="category" dataKey="name" stroke="#4b5563" fontSize={9} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  formatter={(value: any) => [fmtLkr(value), "Spend"]}
                />
                <Bar dataKey="cents" radius={[0, 4, 4, 0]}>
                  {cats.map((_, i) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
