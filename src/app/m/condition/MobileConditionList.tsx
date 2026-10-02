"use client";

import React, { useState, useTransition } from "react";
import { logDailyConditionAction } from "@/app/actions/condition";
import { Activity, Check, AlertCircle, Search, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";

interface AssetCondition {
  id: string;
  code: string;
  regNo: string | null;
  assetStatus: string;
  todayStatus: string | null;
  todayNote: string | null;
}

export default function MobileConditionList({
  assets,
}: {
  assets: AssetCondition[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"ALL" | "UNLOGGED" | "BREAKDOWN">("ALL");

  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [breakdownNote, setBreakdownNote] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const filtered = assets.filter((a) => {
    const matchesSearch =
      a.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.regNo && a.regNo.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === "UNLOGGED") return a.todayStatus === null;
    if (filterMode === "BREAKDOWN") return a.todayStatus === "BREAKDOWN";
    return true;
  });

  const handleSetCondition = (assetId: string, status: "WORKING" | "BREAKDOWN", note: string | null = null) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        const res = await logDailyConditionAction(assetId, status, note);
        if (res?.error) {
          setErrorMessage(res.error);
        } else {
          setSuccessMessage(`Updated condition to ${status}!`);
          setActiveAssetId(null);
          setBreakdownNote("");
          router.refresh();
        }
      } catch {
        setErrorMessage("Network or server error while updating condition");
      }
    });
  };

  return (
    <div className="space-y-3">
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

      {/* Search & Quick Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter vehicle code..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(["ALL", "UNLOGGED", "BREAKDOWN"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filterMode === mode
                  ? "bg-blue-600 text-white"
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {mode === "ALL"
                ? `All (${assets.length})`
                : mode === "UNLOGGED"
                ? `Unlogged (${assets.filter((a) => !a.todayStatus).length})`
                : `Breakdown (${assets.filter((a) => a.todayStatus === "BREAKDOWN").length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Asset List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
            No matching machines found.
          </div>
        ) : (
          filtered.map((asset) => (
            <div
              key={asset.id}
              className={`p-3 rounded-2xl border transition-all ${
                asset.todayStatus === "BREAKDOWN"
                  ? "bg-red-950/20 border-red-900/50"
                  : asset.todayStatus === "WORKING"
                  ? "bg-slate-900 border-slate-800/80"
                  : "bg-slate-900/60 border-slate-800/40 border-dashed"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-bold text-sm text-white font-mono tracking-wide">
                    {asset.code}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {asset.regNo || "Standard Asset"}
                  </div>
                </div>

                <div className="text-right">
                  {asset.todayStatus ? (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        asset.todayStatus === "BREAKDOWN"
                          ? "bg-red-500/20 border-red-500/40 text-red-300"
                          : "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                      }`}
                    >
                      {asset.todayStatus}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 italic">
                      Not logged today
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleSetCondition(asset.id, "WORKING")}
                  className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                    asset.todayStatus === "WORKING"
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>WORKING</span>
                </button>

                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setActiveAssetId(asset.id);
                    setBreakdownNote(asset.todayNote || "");
                  }}
                  className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                    asset.todayStatus === "BREAKDOWN"
                      ? "bg-red-600 text-white shadow-md shadow-red-600/20"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>BREAKDOWN</span>
                </button>
              </div>

              {/* Breakdown Note Modal / Inline for this asset */}
              {activeAssetId === asset.id && (
                <div className="mt-3 p-2.5 rounded-xl bg-slate-950 border border-red-900/60 space-y-2">
                  <div className="flex items-center justify-between text-xs text-red-400 font-semibold">
                    <span>Breakdown Reason / Fault:</span>
                    <button
                      type="button"
                      onClick={() => setActiveAssetId(null)}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={breakdownNote}
                    onChange={(e) => setBreakdownNote(e.target.value)}
                    placeholder="e.g. Engine overheating, hydraulic hose leak"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSetCondition(asset.id, "BREAKDOWN", breakdownNote)}
                    className="w-full py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs"
                  >
                    Confirm Breakdown
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
