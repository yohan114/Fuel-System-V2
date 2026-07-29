"use client";

import React, { useState, useTransition } from "react";
import { logDailyConditionAction } from "@/app/actions/condition";
import { Gauge, CheckCircle, AlertTriangle, Clock, Search, ShieldCheck, MapPin, User2 } from "lucide-react";

interface AssetConditionProp {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
  status: string; // "ACTIVE" | "INACTIVE"
  typeLabel?: string | null;
  project?: { code: string; name: string } | null;
  dailyConditions: Array<{
    status: string;
    note: string | null;
    createdAt?: string | Date | null;
    recordedBy?: { name: string } | null;
  }>;
}

interface ConditionWidgetProps {
  initialAssets: AssetConditionProp[];
  isLocked: boolean;
  lockMessage: string;
  isAdmin?: boolean;
}

/** Today's condition for a machine, falling back to its standing status. */
function conditionOf(asset: AssetConditionProp): "WORKING" | "BREAKDOWN" {
  const log = asset.dailyConditions[0];
  if (log) return log.status === "BREAKDOWN" ? "BREAKDOWN" : "WORKING";
  return asset.status === "ACTIVE" ? "WORKING" : "BREAKDOWN";
}

function timeOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Row and ReasonRow live at module scope on purpose. Declaring them inside
// ConditionWidget would create a new component type on every render, so React
// would unmount and remount the subtree — which makes the reason input lose
// focus after each keystroke.

function ConditionRow({
  asset,
  isAdmin,
  isLocked,
  isUpdating,
  onSetWorking,
  onStartBreakdown,
}: {
  asset: AssetConditionProp;
  isAdmin: boolean;
  isLocked: boolean;
  isUpdating: boolean;
  onSetWorking: () => void;
  onStartBreakdown: () => void;
}) {
  const log = asset.dailyConditions[0];
  const currentCondition = conditionOf(asset);
  const isDown = currentCondition === "BREAKDOWN";
  const at = timeOf(log?.createdAt);

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 text-xs ${
        isDown ? "bg-red-500/[0.07] border-l-2 border-red-500 -mx-2 px-2 rounded-r-lg" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-bold tracking-wide ${isDown ? "text-red-300" : "text-white"}`}>{asset.code}</span>
          {asset.regNo && <span className="text-[10px] text-gray-500 font-mono">({asset.regNo})</span>}
          {isDown && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-500/15 text-red-300 border border-red-500/20 tracking-wider">
              DOWN
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-1 flex-wrap">
          <MapPin className="w-3 h-3 text-gray-500" />
          <span className={asset.project ? "font-semibold text-gray-400" : "italic"}>
            {asset.project ? `${asset.project.name} (${asset.project.code})` : "No site allocated"}
          </span>
          <span>•</span>
          <Gauge className="w-3 h-3 text-gray-500" />
          <span>{asset.meterType}</span>
          {asset.typeLabel && (
            <>
              <span>•</span>
              <span>{asset.typeLabel}</span>
            </>
          )}
          <span>•</span>
          <span className="flex items-center gap-0.5 font-semibold">
            {isDown ? (
              <>
                <AlertTriangle className="w-3 h-3 text-red-500" />
                <span className="text-red-400">Breakdown</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-400">Working</span>
              </>
            )}
          </span>
        </div>

        {/* Who reported it and why — the part that makes a breakdown actionable. */}
        {isDown && (log?.note || log?.recordedBy || at) && (
          <div className="flex items-start gap-1.5 text-[10px] text-red-200/70 mt-1.5">
            <User2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              {log?.recordedBy?.name ? <strong className="text-red-200">{log.recordedBy.name}</strong> : "Reported"}
              {at ? ` at ${at}` : ""}
              {log?.note ? ` — ${log.note}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Restoring from breakdown is admin-only */}
        {isDown && !isAdmin ? (
          <div
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/5 text-gray-600 cursor-not-allowed"
            title="Only an admin can restore from breakdown"
          >
            <ShieldCheck className="w-3 h-3" /> Admin only
          </div>
        ) : (
          <button
            disabled={isLocked || isUpdating}
            onClick={onSetWorking}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider active:scale-95 transition-all ${
              currentCondition === "WORKING"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/10"
                : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-600 hover:text-white"
            } disabled:opacity-50 disabled:pointer-events-none`}
          >
            {isUpdating ? "…" : "Working"}
          </button>
        )}
        <button
          disabled={isLocked || isUpdating || isDown}
          onClick={onStartBreakdown}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider active:scale-95 transition-all ${
            isDown
              ? "bg-red-600 text-white shadow-md shadow-red-500/10"
              : "bg-white/5 text-gray-400 hover:text-white"
          } disabled:opacity-50 disabled:pointer-events-none`}
        >
          Breakdown
        </button>
      </div>
    </div>
  );
}

function ReasonRow({
  asset,
  value,
  onChange,
  onCancel,
  onConfirm,
  busy,
}: {
  asset: AssetConditionProp;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="py-3 space-y-2 bg-amber-500/[0.06] border-l-2 border-amber-500 -mx-2 px-2 rounded-r-lg">
      <div className="flex items-center gap-2 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        <span className="font-bold text-amber-200">{asset.code}</span>
        <span className="text-[10px] text-amber-200/70">
          — why is it down? {asset.project ? `(${asset.project.code})` : ""}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="e.g. hydraulic hose burst, waiting for parts"
          className="flex-1 bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500/50"
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-xl text-[10px] font-bold bg-white/5 text-gray-400 hover:text-white active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={onConfirm}
            className="px-3 py-2 rounded-xl text-[10px] font-bold bg-red-600 hover:bg-red-700 text-white active:scale-95 transition-all disabled:opacity-50"
          >
            Mark as down
          </button>
        </div>
      </div>
    </div>
  );
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
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Machine awaiting a breakdown reason. Nothing is written until the reason
  // step is confirmed — a breakdown with no stated cause is not actionable, and
  // it is what fills the "Last note" column on the Breakdown Log.
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  const applyCondition = (
    assetId: string,
    currentStatus: string,
    targetStatus: "WORKING" | "BREAKDOWN",
    note: string | null = null,
  ) => {
    if (isLocked) return;
    if (currentStatus === targetStatus) return;

    setUpdatingId(assetId);
    setError(null);

    startTransition(async () => {
      try {
        const res = await logDailyConditionAction(assetId, targetStatus, note);
        setUpdatingId(null);

        if (res.error) {
          setError(res.error);
        } else {
          setReasonFor(null);
          setReasonText("");
          setAssets((prev) =>
            prev.map((a) =>
              a.id === assetId
                ? {
                    ...a,
                    status: targetStatus === "WORKING" ? "ACTIVE" : "INACTIVE",
                    // Preserve the existing note/reporter so a machine just moved
                    // back to working does not lose the record of why it was down.
                    dailyConditions: [
                      {
                        ...(a.dailyConditions[0] ?? { note: null }),
                        status: targetStatus,
                        ...(note !== null ? { note } : {}),
                      },
                    ],
                  }
                : a
            )
          );
        }
      } catch (err) {
        setUpdatingId(null);
        setError(err instanceof Error ? err.message : "An unexpected network or system error occurred.");
      }
    });
  };

  const term = search.trim().toLowerCase();
  const matches = (a: AssetConditionProp) =>
    !term ||
    a.code.toLowerCase().includes(term) ||
    (a.regNo?.toLowerCase().includes(term) ?? false) ||
    (a.project?.code.toLowerCase().includes(term) ?? false) ||
    (a.project?.name.toLowerCase().includes(term) ?? false);

  const filteredAssets = assets.filter(matches);

  // Anything reported down today is pulled to the front of the list, so a
  // breakdown logged at a site surfaces immediately instead of being buried
  // alphabetically among hundreds of working machines. Ordered by site, so
  // several machines down at one site read as a single problem.
  const downNow = filteredAssets
    .filter((a) => conditionOf(a) === "BREAKDOWN")
    .sort((a, b) => (a.project?.code ?? "~").localeCompare(b.project?.code ?? "~") || a.code.localeCompare(b.code));
  const workingNow = filteredAssets.filter((a) => conditionOf(a) !== "BREAKDOWN");

  // Site rollup for the alert banner (counted across all machines, not just the
  // current search, so filtering never hides the true breakdown count).
  const bySite = new Map<string, number>();
  for (const a of assets) {
    if (conditionOf(a) !== "BREAKDOWN") continue;
    const key = a.project?.code ?? "Unassigned";
    bySite.set(key, (bySite.get(key) ?? 0) + 1);
  }
  const totalDown = [...bySite.values()].reduce((s, n) => s + n, 0);

  const pendingAsset = reasonFor ? workingNow.find((a) => a.id === reasonFor) ?? null : null;

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Daily Machinery &amp; Vehicle Condition Logs
          </h3>
          <p className="text-[11px] text-gray-400 mt-1">
            Report breakdown status daily. Machines reported down are pinned to the top
            until they are put back to working.
          </p>
        </div>

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

      {/* Breakdown alert banner — the "something is down right now" signal. */}
      {totalDown > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-red-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-pulse" />
            <span>
              {totalDown} machine{totalDown !== 1 ? "s" : ""} reported down today
              {bySite.size > 1 ? ` across ${bySite.size} sites` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...bySite.entries()]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([site, n]) => (
                <span
                  key={site}
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/15 text-red-200 border border-red-500/20"
                >
                  {site} · {n}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Local search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
        <input
          type="text"
          placeholder="Search by machine code, registration or site..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      {/* Machine Directory Toggles */}
      <div className="max-h-[360px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/5">
        {filteredAssets.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-500">
            {term ? "No machines match that search." : "No active project assets found."}
          </div>
        ) : (
          <>
            {downNow.length > 0 && (
              <div className="divide-y divide-red-500/10 mb-2">
                {downNow.map((asset) => (
                  <ConditionRow
                    key={asset.id}
                    asset={asset}
                    isAdmin={isAdmin}
                    isLocked={isLocked}
                    isUpdating={updatingId === asset.id}
                    onSetWorking={() => applyCondition(asset.id, "BREAKDOWN", "WORKING")}
                    onStartBreakdown={() => undefined}
                  />
                ))}
              </div>
            )}

            {/* A machine mid-report sits above the working list so the prompt is
                never scrolled out of view. */}
            {pendingAsset && (
              <ReasonRow
                asset={pendingAsset}
                value={reasonText}
                onChange={setReasonText}
                onCancel={() => setReasonFor(null)}
                onConfirm={() => applyCondition(pendingAsset.id, "WORKING", "BREAKDOWN", reasonText.trim() || null)}
                busy={updatingId === pendingAsset.id}
              />
            )}

            {downNow.length > 0 && workingNow.length > 0 && (
              <div className="flex items-center gap-2 py-2 text-[9px] font-bold text-gray-600 uppercase tracking-wider">
                <span className="h-px flex-1 bg-white/5" />
                Working ({workingNow.length})
                <span className="h-px flex-1 bg-white/5" />
              </div>
            )}

            <div className="divide-y divide-white/5">
              {workingNow
                .filter((asset) => asset.id !== reasonFor)
                .map((asset) => (
                  <ConditionRow
                    key={asset.id}
                    asset={asset}
                    isAdmin={isAdmin}
                    isLocked={isLocked}
                    isUpdating={updatingId === asset.id}
                    onSetWorking={() => applyCondition(asset.id, "BREAKDOWN", "WORKING")}
                    onStartBreakdown={() => {
                      setError(null);
                      setReasonText("");
                      setReasonFor(asset.id);
                    }}
                  />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
