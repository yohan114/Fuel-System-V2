"use client";

import React, { useState, useTransition } from "react";
import { updateFuelConsumptionAction } from "@/app/actions/billing";
import { Fuel, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";

interface Props {
  assetId: string;
  meterType: string; // "HOURS" | "KM"
  fuelConsEcon: number | null;
  fuelConsTyp: number | null;
  fuelConsBasis: string | null;
}

export default function FuelConsumptionEditor({ assetId, meterType, fuelConsEcon, fuelConsTyp, fuelConsBasis }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const defaultBasis = fuelConsBasis || (meterType === "KM" ? "km" : "hr");

  // Live mid-rate preview
  const [econ, setEcon] = useState(fuelConsEcon != null ? String(fuelConsEcon) : "");
  const [typ, setTyp] = useState(fuelConsTyp != null ? String(fuelConsTyp) : "");
  const [basis, setBasis] = useState(defaultBasis);

  const e = parseFloat(econ);
  const t = parseFloat(typ);
  const mid = Number.isFinite(e) && Number.isFinite(t) && e > 0 && t > 0 ? (e + t) / 2 : null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateFuelConsumptionAction(assetId, formData);
      if (res.error) setError(res.error);
      else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2500);
      }
    });
  };

  const inputCls = "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50";
  const labelCls = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2";

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center gap-2 mb-1">
        <Fuel className="w-4 h-4 text-amber-400" />
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Fuel Consumption Rate</h3>
      </div>
      <p className="text-[11px] text-gray-500 mb-5">
        Used when a billing month has <span className="text-gray-300">no meter readings</span>. The billable {meterType === "KM" ? "kilometres" : "hours"} are
        derived as <span className="text-gray-300">monthly fuel litres ÷ mid consumption rate</span>.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2 mb-4">
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> <span>Consumption rate saved.</span>
        </div>
      )}

      <form action={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Basis</label>
            <select name="fuelConsBasis" value={basis} onChange={(ev) => setBasis(ev.target.value)} className={inputCls}>
              <option value="hr">L / hr</option>
              <option value="km">L / km</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Economic (light load)</label>
            <input
              name="fuelConsEcon"
              type="number"
              step="any"
              value={econ}
              onChange={(ev) => setEcon(ev.target.value)}
              placeholder="e.g. 8.5"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Typical (heavy load)</label>
            <input
              name="fuelConsTyp"
              type="number"
              step="any"
              value={typ}
              onChange={(ev) => setTyp(ev.target.value)}
              placeholder="e.g. 12.0"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-gray-400">
            Mid rate used:{" "}
            <span className="text-amber-400 font-bold">
              {mid != null ? `${mid.toFixed(2)} L/${basis}` : "—"}
            </span>
          </p>
          <button
            type="submit"
            disabled={isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
          >
            {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Save Rate
          </button>
        </div>
      </form>
    </div>
  );
}
