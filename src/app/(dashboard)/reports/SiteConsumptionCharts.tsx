"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend
} from "recharts";
import { Fuel, BarChart3, ListCollapse } from "lucide-react";

interface SiteDataPoint {
  id: string;
  name: string;
  code: string;
  autoLitres: number;
  superLitres: number;
  totalLitres: number;
  costCents: number;
  issueCount: number;
  vehicleCount?: number;
}

interface SiteConsumptionChartsProps {
  siteData: SiteDataPoint[];
}

export default function SiteConsumptionCharts({ siteData }: SiteConsumptionChartsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 h-80 animate-pulse" />
    );
  }

  // Format currency
  const formatLkr = (cents: number) => {
    return `Rs. ${(cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Chart Section */}
      <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
        <div>
          <h3 className="text-md font-bold text-white tracking-wide flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            Site-Wise Consumption Volume (L)
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Comparing Auto vs Super Diesel litres dispensed per project site
          </p>
        </div>

        <div className="h-72 w-full mt-6">
          {siteData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              No consumption recorded in this range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={siteData}
                layout="vertical" // Horizontal bar layout
                margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
              >
                <XAxis 
                  type="number"
                  stroke="#4b5563" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  dataKey="name" 
                  type="category"
                  stroke="#4b5563" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  width={120}
                  tickFormatter={(val) => val.length > 18 ? `${val.substring(0, 15)}...` : val}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px", fontWeight: "bold" }}
                  itemStyle={{ fontSize: "11px" }}
                  formatter={(value: any, name: any) => [`${value.toFixed(1)} L`, name]}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
                <Bar 
                  dataKey="autoLitres" 
                  name="Auto Diesel" 
                  stackId="siteStack" 
                  fill="#4f46e5" 
                  radius={[0, 4, 4, 0]} 
                />
                <Bar 
                  dataKey="superLitres" 
                  name="Super Diesel" 
                  stackId="siteStack" 
                  fill="#10b981" 
                  radius={[0, 4, 4, 0]} 
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Summary Table Section */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
        <div className="space-y-4">
          <h3 className="text-md font-bold text-white tracking-wide flex items-center gap-2 border-b border-white/5 pb-3">
            <ListCollapse className="w-4 h-4 text-indigo-400" />
            Project Site Breakdown
          </h3>

          <div className="space-y-3.5 max-h-[260px] overflow-y-auto pr-1">
            {siteData.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-500">No data available.</div>
            ) : (
              siteData.map((site) => (
                <div key={site.id} className="flex items-center justify-between text-xs border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
                  <div className="space-y-0.5">
                    <span className="font-bold text-white block truncate max-w-[150px]">{site.name}</span>
                    <span className="text-[9px] bg-white/5 text-gray-400 font-mono font-bold px-1.5 py-0.5 rounded uppercase">
                      {site.code}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-white block">{site.totalLitres.toFixed(1)} L</span>
                    <span className="text-[10px] text-gray-500 font-semibold">{formatLkr(site.costCents)}</span>
                    {site.vehicleCount != null && (
                      <span className="text-[10px] text-indigo-400 font-semibold block">{site.vehicleCount} vehicles</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
