"use client";

import React, { useState, useTransition } from "react";
import { addReadingAction } from "@/app/actions/readings";
import { Gauge, Check, AlertCircle, Search, RefreshCw, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
  lastReading: number | null;
}

export default function MobileReadingsForm({ assets }: { assets: AssetOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [readingValue, setReadingValue] = useState("");
  const [allowLower, setAllowLower] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  const filteredAssets = searchQuery.trim()
    ? assets
        .filter(
          (a) =>
            a.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (a.regNo && a.regNo.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        .slice(0, 10)
    : assets.slice(0, 8);

  const valNum = parseFloat(readingValue);
  const isLowerThanLast =
    selectedAsset?.lastReading !== null &&
    selectedAsset?.lastReading !== undefined &&
    !isNaN(valNum) &&
    valNum < selectedAsset.lastReading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedAssetId) {
      setErrorMessage("Please select a vehicle or asset");
      return;
    }

    if (isNaN(valNum) || valNum < 0) {
      setErrorMessage("Please enter a valid meter reading");
      return;
    }

    if (isLowerThanLast && !allowLower) {
      setErrorMessage(
        `Reading (${valNum}) is lower than previous reading (${selectedAsset?.lastReading}). Check checkbox to confirm meter replacement/reset.`
      );
      return;
    }

    const colomboToday = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Colombo",
    });

    const formData = new FormData();
    formData.append("assetId", selectedAssetId);
    formData.append("value", readingValue);
    formData.append("readingDate", colomboToday);
    if (allowLower) formData.append("adminOverride", "true");

    startTransition(async () => {
      try {
        const res = await addReadingAction(formData);
        if (res.error) {
          setErrorMessage(res.error);
        } else {
          setSuccessMessage(
            `Logged meter ${readingValue} ${selectedAsset?.meterType} for ${selectedAsset?.code}!`
          );
          setReadingValue("");
          setAllowLower(false);
          router.refresh();
        }
      } catch {
        setErrorMessage("Network or server error while logging meter reading");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 1. Vehicle Selection */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
          1. Select Vehicle
        </label>

        {selectedAsset ? (
          <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-600/10 border border-emerald-500/40">
            <div>
              <div className="text-base font-bold text-white tracking-wide font-mono">
                {selectedAsset.code}
              </div>
              <div className="text-xs text-slate-400">
                {selectedAsset.regNo ? `${selectedAsset.regNo} • ` : ""}
                Meter Type: <span className="font-semibold text-emerald-400">{selectedAsset.meterType}</span>
              </div>
              {selectedAsset.lastReading !== null && (
                <div className="text-xs text-slate-300 mt-0.5">
                  Last Logged: <span className="font-mono font-bold text-white">{selectedAsset.lastReading}</span> {selectedAsset.meterType}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedAssetId("")}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code (e.g. DT-123, EX...)"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSelectedAssetId(asset.id)}
                  className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/50 text-left active:bg-emerald-600/20 transition-colors"
                >
                  <div className="font-bold text-xs text-white font-mono">
                    {asset.code}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {asset.lastReading !== null ? `${asset.lastReading} ${asset.meterType}` : asset.meterType}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Meter Reading Value */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            2. Current Odometer / Hour Meter
          </label>
          <span className="text-xs text-emerald-400 font-mono font-bold">
            {selectedAsset?.meterType || "KM/HOURS"}
          </span>
        </div>

        <div className="relative">
          <input
            type="number"
            step="0.1"
            min="0"
            required
            value={readingValue}
            onChange={(e) => setReadingValue(e.target.value)}
            placeholder="0.0"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-2xl font-mono font-bold text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-center"
          />
        </div>

        {/* Delta feedback */}
        {selectedAsset?.lastReading !== null && !isNaN(valNum) && (
          <div className="text-center text-xs">
            {valNum >= selectedAsset!.lastReading! ? (
              <span className="text-emerald-400 font-mono">
                +{(valNum - selectedAsset!.lastReading!).toFixed(1)} {selectedAsset?.meterType} delta
              </span>
            ) : (
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-left mt-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div>
                  <div className="font-semibold text-xs">Reading is lower than previous!</div>
                  <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={allowLower}
                      onChange={(e) => setAllowLower(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                    />
                    <span>Confirm meter replacement / odometer rollover</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 active:scale-[0.98] transition-all"
      >
        {isPending ? (
          <>
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Logging Meter Reading...</span>
          </>
        ) : (
          <>
            <Gauge className="w-5 h-5" />
            <span>LOG METER READING</span>
          </>
        )}
      </button>
    </form>
  );
}
