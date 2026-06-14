"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from "recharts";

interface ChartDataPoint {
  date: string;
  litres: number;
  cost: number;
}

interface DashboardChartsProps {
  trendData: ChartDataPoint[];
  autoDieselLitres: number;
  superDieselLitres: number;
  autoDieselCost: number;
  superDieselCost: number;
}

export default function DashboardCharts({
  trendData,
  autoDieselLitres,
  superDieselLitres,
  autoDieselCost,
  superDieselCost
}: DashboardChartsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-80 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
        <div className="h-80 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  // Format money inside tooltip
  const formatLkr = (cents: number) => {
    return `Rs. ${(cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Pie chart data
  const pieData = [
    { name: "Auto Diesel", value: autoDieselLitres, cost: autoDieselCost, color: "#4f46e5" },
    { name: "Super Diesel", value: superDieselLitres, cost: superDieselCost, color: "#10b981" }
  ].filter(d => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* 1. Daily Consumption Trend Chart */}
      <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-md font-bold text-white tracking-wide">Daily Fuel Cost & Spend</h3>
            <p className="text-xs text-gray-400">Issued fuel costs recorded day-by-day this month</p>
          </div>
        </div>

        <div className="h-72 w-full">
          {trendData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              No consumption recorded yet this month.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  stroke="#4b5563" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="#4b5563" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(val) => `Rs.${(val / 100).toLocaleString("en-LK", { notation: "compact" })}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "12px", fontWeight: "bold" }}
                  formatter={(value: any, name: any) => {
                    if (name === "Spend (LKR)") return [formatLkr(value), name];
                    return [`${value.toFixed(1)} L`, name];
                  }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Area 
                  type="monotone" 
                  dataKey="cost" 
                  name="Spend (LKR)"
                  stroke="#4f46e5" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorCost)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. Fuel Kind Split Pie Chart */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col">
        <h3 className="text-md font-bold text-white tracking-wide mb-1">Fuel Split Ratio</h3>
        <p className="text-xs text-gray-400 mb-6 font-medium">Auto vs Super Diesel consumption</p>

        <div className="relative flex-1 h-56 flex items-center justify-center">
          {pieData.length === 0 ? (
            <div className="text-sm text-gray-500">No issues this month.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  formatter={(value: any, name: any, props: any) => {
                    return [`${value.toFixed(1)} Litres (${formatLkr(props.payload.cost)})`, name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          {/* Centered Total */}
          {pieData.length > 0 && (
            <div className="absolute flex flex-col items-center">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Total</span>
              <span className="text-xl font-extrabold text-white">
                {(autoDieselLitres + superDieselLitres).toFixed(0)}L
              </span>
            </div>
          )}
        </div>

        {/* Legend Custom */}
        <div className="space-y-2 pt-4 border-t border-white/5">
          {pieData.map((d, index) => {
            const total = autoDieselLitres + superDieselLitres;
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0.0";
            return (
              <div key={index} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-gray-300 font-medium">{d.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-bold">{pct}%</span>
                  <span className="text-gray-500 ml-1">({d.value.toFixed(0)}L)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
    </div>
  );
}
