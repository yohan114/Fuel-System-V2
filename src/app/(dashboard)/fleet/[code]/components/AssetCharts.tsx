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
  Legend
} from "recharts";

interface ReadingPoint {
  date: string;
  value: number;
}

interface IssuePoint {
  date: string;
  litres: number;
}

interface AssetChartsProps {
  readingsData: ReadingPoint[];
  issuesData: IssuePoint[];
  meterType: string;
}

export default function AssetCharts({ readingsData, issuesData, meterType }: AssetChartsProps) {
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 1. Cumulative Usage Chart */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          Usage Curve ({meterType})
        </h3>
        <div className="h-60 w-full">
          {readingsData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              No meter readings logged yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={readingsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
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
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any) => [`${value.toLocaleString()} ${meterType}`, "Reading"]}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#10b981" }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. Fuel Issues Intake Chart */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          Fuel Intake History (L)
        </h3>
        <div className="h-60 w-full">
          {issuesData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              No fuel issues recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={issuesData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
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
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any) => [`${value.toFixed(1)} Litres`, "Volume"]}
                />
                <Bar 
                  dataKey="litres" 
                  fill="#4f46e5" 
                  radius={[4, 4, 0, 0]}
                  maxBarSize={30}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
