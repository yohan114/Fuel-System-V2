"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";
import { AlertTriangle, Gauge } from "lucide-react";

export interface BandPoint {
  date: string;
  /** Display units — km/L for road vehicles, L/hr for machinery. */
  actual: number;
  litres: number;
  meterDelta: number;
  days: number;
}

interface Props {
  points: BandPoint[];
  /** Display units. For km/L, econ is the HIGHEST value. */
  econ: number | null;
  typ: number | null;
  heavy: number | null;
  unit: string;
  /** true when a higher number is better (km/L). */
  higherIsBetter: boolean;
  comparable: boolean;
  bandReason: string;
  emptyReason: string | null;
  intervals: number;
}

const REASON_COPY: Record<string, string> = {
  "no-rate-card": "This machine has no rate card, so there is no standard to compare against.",
  "no-band": "No standard consumption has been set for this machine yet.",
  "basis-conflict":
    "The rate card quotes this machine per hour, but it is set to a kilometre meter. The two cannot be compared until the meter type is corrected.",
};

export default function ConsumptionBandChart({
  points, econ, typ, heavy, unit, higherIsBetter, comparable, bandReason, emptyReason, intervals,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panel = "bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl";
  const title = (
    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
      <Gauge className="w-4 h-4 text-indigo-400" />
      Actual vs Standard Consumption
    </h3>
  );

  if (!mounted) {
    return <div className="h-80 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />;
  }

  // Nothing measured. Still show the standard, so the rate card is visible.
  if (points.length === 0) {
    return (
      <div className={panel}>
        {title}
        <div className="h-52 flex flex-col items-center justify-center text-center gap-3">
          <AlertTriangle className="w-6 h-6 text-gray-600" />
          <p className="text-xs text-gray-400 max-w-sm">{emptyReason ?? "Nothing measured yet."}</p>
          {typ != null ? (
            <p className="text-[11px] text-gray-500">
              Standard for this machine:{" "}
              <span className="text-gray-300 font-semibold">
                {econ != null ? `${econ.toFixed(1)} / ` : ""}
                {typ.toFixed(1)}
                {heavy != null ? ` / ${heavy.toFixed(1)}` : ""} {unit}
              </span>
              <span className="block mt-0.5">
                {higherIsBetter ? "economy / standard / heavy — higher is better" : "economy / standard / heavy — lower is better"}
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">{REASON_COPY[bandReason] ?? ""}</p>
          )}
        </div>
      </div>
    );
  }

  const values = points.map((p) => p.actual);
  const bandVals = [econ, typ, heavy].filter((v): v is number => v != null);
  const lo = Math.min(...values, ...bandVals);
  const hi = Math.max(...values, ...bandVals);
  const pad = (hi - lo) * 0.15 || hi * 0.15 || 1;
  const domain: [number, number] = [Math.max(0, lo - pad), hi + pad];

  // For km/L (higher is better) the "bad" zone is BELOW heavy; for L/hr it is
  // above. Shading the correct side is the whole point of the chart.
  const badZone = comparable && heavy != null
    ? higherIsBetter
      ? { y1: domain[0], y2: heavy }
      : { y1: heavy, y2: domain[1] }
    : null;
  const goodZone = comparable && econ != null
    ? higherIsBetter
      ? { y1: econ, y2: domain[1] }
      : { y1: domain[0], y2: econ }
    : null;

  return (
    <div className={panel}>
      {title}

      {!comparable ? (
        <p className="text-[11px] text-amber-400/90 mb-3">{REASON_COPY[bandReason] ?? "Standard not comparable."}</p>
      ) : intervals < 3 ? (
        <p className="text-[11px] text-amber-400/90 mb-3">
          Only {intervals} measured {intervals === 1 ? "interval" : "intervals"} — not yet enough to call a verdict.
          Partial fills make a single reading pair unreliable.
        </p>
      ) : null}

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
            {badZone ? (
              <ReferenceArea y1={badZone.y1} y2={badZone.y2} fill="#f43f5e" fillOpacity={0.07} strokeOpacity={0} />
            ) : null}
            {goodZone ? (
              <ReferenceArea y1={goodZone.y1} y2={goodZone.y2} fill="#10b981" fillOpacity={0.06} strokeOpacity={0} />
            ) : null}

            <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#ffffff10" }} />
            <YAxis
              domain={domain}
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#ffffff10" }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{ background: "#1b1e30", border: "1px solid #ffffff14", borderRadius: 12, fontSize: 11 }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value, name, item) => {
                const v = typeof value === "number" ? value : Number(value);
                const p = (item as { payload?: BandPoint } | undefined)?.payload;
                if (!Number.isFinite(v)) return [String(value), String(name)];
                return [
                  `${v.toFixed(2)} ${unit}${p ? ` — ${p.litres} L over ${p.meterDelta.toLocaleString()} ${higherIsBetter ? "km" : "hr"} (${p.days}d)` : ""}`,
                  "Actual",
                ];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />

            {comparable && econ != null ? (
              <ReferenceLine y={econ} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.7}
                label={{ value: "econ", fill: "#10b981", fontSize: 9, position: "right" }} />
            ) : null}
            {comparable && typ != null ? (
              <ReferenceLine y={typ} stroke="#6366f1" strokeDasharray="6 3"
                label={{ value: "standard", fill: "#818cf8", fontSize: 9, position: "right" }} />
            ) : null}
            {comparable && heavy != null ? (
              <ReferenceLine y={heavy} stroke="#f43f5e" strokeDasharray="4 4" strokeOpacity={0.7}
                label={{ value: "heavy", fill: "#f43f5e", fontSize: 9, position: "right" }} />
            ) : null}

            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#818cf8"
              strokeWidth={2}
              dot={{ r: 3, fill: "#818cf8" }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-gray-500 mt-3">
        Measured fill to fill: litres issued divided by meter movement. {unit}
        {higherIsBetter ? " — higher is better." : " — lower is better."} The standard band is a class estimate from the
        2026 rate sheet, not a measurement of this machine.
      </p>
    </div>
  );
}
