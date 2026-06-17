"use client";

import React, { useState, useTransition } from "react";
import { logDailyConditionAction } from "@/app/actions/condition";
import { Gauge, CheckCircle, AlertTriangle, Clock, Search, ShieldCheck } from "lucide-react";

interface AssetConditionProp {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
  status: string; // "ACTIVE" | "INACTIVE"
  dailyConditions: Array<{
    status: string;
    note: string | null;
  }>;
}

interface ConditionWidgetProps {
  initialAssets: AssetConditionProp[];
  isLocked: boolean;
  lockMessage: string;
  isAdmin?: boolean;
}

export default function ConditionWidget({
  initialAssets,
  isLocked,
  lockMessage,
  isAdmin = false,
}: ConditionWidgetProps) {
  const [assets, setAssets] = useState<AssetConditionProp[]>(initialAssets);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggleCondition = async (assetId: string, currentStatus: string, targetStatus: "WORKING" | "BREAKDOWN") => {
    if (isLocked) return;
    if (currentStatus === targetStatus) return;

    setUpdatingId(assetId);
    setError(null);

    startTransition(async () => {
      try {
        const res = await logDailyConditionAction(assetId, targetStatus);
        setUpdatingId(null);

        if (res.error) {
          setError(res.error);
        } else {
          setAssets((prev) =>
            prev.map((a) =>
              a.id === assetId
                ? {
                    ...a,
                    status: targetStatus === "WORKING" ? "ACTIVE" : "INACTIVE",
                    dailyConditions: [{ status: targetStatus, note: null }],
                  }
                : a
            )
          );
        }
      } catch (err: any) {
        setUpdatingId(null);
        setError(err?.message || "An unexpected network or system error occurred.");
      }
    });
  };

  const filteredAssets = assets.filter((a) =>
    a.code.toLowerCase().includes(search.toLowerCase()) ||
    a.regNo?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Daily Machinery & Vehicle Condition Logs
          </h3>
          <p className="text-[11px] text-gray-400 mt-1">
            Report breakdown status daily. Submissions automatically close at 17:00 PM.
          </p>
        </div>

        {/* Lockout status indicator badge */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
            isLocked 
              ? "bg-red-500/10 text-red-400 border border-red-500/15" 
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{lockMessage}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Local search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
        <input
          type="text"
          placeholder="Quick search project machinery..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      {/* Machine Directory Toggles */}
      <div className="divide-y divide-white/5 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/5">
        {filteredAssets.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-500">
            No active project assets found.
          </div>
        ) : (
          filteredAssets.map((asset) => {
            // Determine active daily status
            const logEntry = asset.dailyConditions[0];
            const currentCondition = logEntry 
              ? logEntry.status 
              : (asset.status === "ACTIVE" ? "WORKING" : "BREAKDOWN");

            const isUpdating = updatingId === asset.id;

            return (
              <div key={asset.id} className="flex items-center justify-between py-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white tracking-wide">{asset.code}</span>
                    {asset.regNo && (
                      <span className="text-[10px] text-gray-500 font-mono">({asset.regNo})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-0.5">
                    <Gauge className="w-3 h-3 text-gray-500" />
                    <span>Unit: {asset.meterType}</span>
                    <span>•</span>
                    <span className="flex items-center gap-0.5 font-semibold">
                      {currentCondition === "WORKING" ? (
                        <>
                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-400">Working</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3 h-3 text-red-500" />
                          <span className="text-red-400">Breakdown</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center gap-1.5">
                  {/* Restoring from breakdown is admin-only */}
                  {currentCondition === "BREAKDOWN" && !isAdmin ? (
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/5 text-gray-600 cursor-not-allowed" title="Only an admin can restore from breakdown">
                      <ShieldCheck className="w-3 h-3" /> Admin only
                    </div>
                  ) : (
                    <button
                      disabled={isLocked || isUpdating}
                      onClick={() => handleToggleCondition(asset.id, currentCondition, "WORKING")}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider active:scale-95 transition-all ${
                        currentCondition === "WORKING"
                          ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/10"
                          : "bg-white/5 text-gray-400 hover:text-white"
                      } disabled:opacity-50 disabled:pointer-events-none`}
                    >
                      Working
                    </button>
                  )}
                  <button
                    disabled={isLocked || isUpdating}
                    onClick={() => handleToggleCondition(asset.id, currentCondition, "BREAKDOWN")}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider active:scale-95 transition-all ${
                      currentCondition === "BREAKDOWN"
                        ? "bg-red-600 text-white shadow-md shadow-red-500/10"
                        : "bg-white/5 text-gray-400 hover:text-white"
                    } disabled:opacity-50 disabled:pointer-events-none`}
                  >
                    Breakdown
                  </button>
                </div>

              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
