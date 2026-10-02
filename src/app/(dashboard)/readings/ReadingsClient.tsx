"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addReadingAction } from "@/app/actions/readings";
import { openMeterOutageAction, closeMeterOutageAction } from "@/app/actions/meter-outage";
import {
  Search,
  Gauge,
  AlertTriangle,
  Plus,
  Wrench,
  RotateCcw,
  CheckCircle2,
  X,
  MapPin,
  Clock,
  ArrowRight,
} from "lucide-react";

interface ReadingItem {
  id: string;
  value: number;
  readingType: string;
  readingDate: Date;
  source: string;
  asset: {
    id: string;
    code: string;
    regNo: string | null;
    meterType: string;
  };
  recordedBy: {
    id: string;
    name: string;
  };
}

interface ActiveOutage {
  id: string;
  startDate: Date;
  reason: string | null;
  asset: {
    id: string;
    code: string;
    regNo: string | null;
    meterType: string;
  };
  openedBy: {
    id: string;
    name: string;
  };
}

interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
}

export default function ReadingsClient({
  readings,
  activeOutages,
  assets,
  q,
}: {
  readings: ReadingItem[];
  activeOutages: ActiveOutage[];
  assets: AssetOption[];
  q: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog states
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [openOutageModalOpen, setOpenOutageModalOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<ActiveOutage | null>(null);

  // Notifications
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Record Reading form state
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [meterStatus, setMeterStatus] = useState<"WORKING" | "BROKEN">("WORKING");
  const [readingVal, setReadingVal] = useState("");
  const [readingDate, setReadingDate] = useState(new Date().toISOString().slice(0, 10));
  const [needsOverride, setNeedsOverride] = useState(false);

  // Close Outage form state
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [continuity, setContinuity] = useState<"repaired" | "replaced">("repaired");
  const [endMeter, setEndMeter] = useState("");
  const [closeNote, setCloseNote] = useState("");

  // Open Outage form state
  const [outageAssetId, setOutageAssetId] = useState("");
  const [outageStartDate, setOutageStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [outageReason, setOutageReason] = useState("");

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const assetHasActiveOutage = selectedAsset
    ? activeOutages.some((o) => o.asset.id === selectedAsset.id)
    : false;

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedAssetId || !readingVal) {
      setError("Please select a vehicle and enter a meter value");
      return;
    }

    const fd = new FormData();
    fd.append("assetId", selectedAssetId);
    fd.append("value", readingVal);
    fd.append("readingDate", readingDate);
    if (meterStatus === "BROKEN" || assetHasActiveOutage) {
      fd.append("source", "GOOGLE_ESTIMATE");
      fd.append("isEstimated", "true");
    }
    if (needsOverride) {
      fd.append("adminOverride", "true");
    }

    startTransition(async () => {
      const res = await addReadingAction(fd);
      if (res.error) {
        setError(res.error);
        if (res.needsOverrideOption) {
          setNeedsOverride(true);
        }
      } else {
        setSuccess(
          `Logged ${meterStatus === "BROKEN" ? "Google-estimated" : "physical"} reading for ${selectedAsset?.code}`
        );
        setRecordModalOpen(false);
        setReadingVal("");
        setNeedsOverride(false);
        router.refresh();
      }
    });
  };

  const handleOpenOutage = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const fd = new FormData();
    fd.append("assetId", outageAssetId);
    fd.append("startDate", outageStartDate);
    if (outageReason) fd.append("reason", outageReason);

    startTransition(async () => {
      const res = await openMeterOutageAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess("Reported meter outage successfully");
        setOpenOutageModalOpen(false);
        setOutageAssetId("");
        setOutageReason("");
        router.refresh();
      }
    });
  };

  const handleCloseOutage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeTarget) return;
    setError(null);
    setSuccess(null);

    const fd = new FormData();
    fd.append("outageId", closeTarget.id);
    fd.append("endDate", closeDate);
    fd.append("instrumentContinuity", continuity);
    if (endMeter) fd.append("endPhysicalMeter", endMeter);
    if (closeNote) fd.append("closeNote", closeNote);

    startTransition(async () => {
      const res = await closeMeterOutageAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`Closed meter outage for ${closeTarget.asset.code} (${continuity})`);
        setCloseTarget(null);
        setEndMeter("");
        setCloseNote("");
        router.refresh();
      }
    });
  };

  function fmtDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function getDaysDown(start: Date | string): number {
    const s = new Date(start).getTime();
    return Math.max(1, Math.round((Date.now() - s) / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">Meter Readings Log</h1>
          <p className="text-xs text-gray-400 mt-1">
            Odometer mileage and engine hours log records, representing cumulative usage audits over time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpenOutageModalOpen(true)}
            className="inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Report Broken Meter
          </button>

          <button
            onClick={() => {
              setRecordModalOpen(true);
              setMeterStatus("WORKING");
              setNeedsOverride(false);
            }}
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-md active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            Record Reading
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl p-3.5 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl p-3.5 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active Outages Banner */}
      {activeOutages.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <h2 className="text-sm font-bold text-amber-300 tracking-wide">
                Active Meter Outages ({activeOutages.length} {activeOutages.length === 1 ? "Vehicle" : "Vehicles"})
              </h2>
            </div>
            <Link
              href="/admin/meter-outages"
              className="text-xs text-amber-300/80 hover:text-amber-200 underline font-medium"
            >
              View in Admin Console →
            </Link>
          </div>

          <p className="text-xs text-amber-200/70">
            Physical meters are reported not working for these vehicles. Readings entered for them are automatically tagged as Google Maps estimates.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {activeOutages.map((outage) => {
              const days = getDaysDown(outage.startDate);
              return (
                <div
                  key={outage.id}
                  className="bg-[#121420]/80 border border-amber-500/30 rounded-xl p-3.5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/fleet/${outage.asset.code}`}
                        className="font-bold text-white hover:text-amber-300 text-sm tracking-wide"
                      >
                        {outage.asset.code}
                      </Link>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        days > 14
                          ? "bg-red-500/20 text-red-300 border border-red-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}>
                        Down {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-400 mt-1">
                      Since {fmtDate(outage.startDate)} • {outage.asset.meterType}
                    </div>

                    {outage.reason && (
                      <div className="text-xs text-amber-200/90 mt-1.5 italic truncate" title={outage.reason}>
                        &ldquo;{outage.reason}&rdquo;
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <button
                      onClick={() => {
                        setSelectedAssetId(outage.asset.id);
                        setMeterStatus("BROKEN");
                        setRecordModalOpen(true);
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3" />
                      Log Estimate
                    </button>

                    <button
                      onClick={() => {
                        setCloseTarget(outage);
                        setCloseDate(new Date().toISOString().slice(0, 10));
                        setContinuity("repaired");
                        setEndMeter("");
                        setCloseNote("");
                      }}
                      className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[10px] font-bold transition-all border border-emerald-500/30"
                    >
                      Mark Repaired / Replaced
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter and Search Panel */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex items-center">
        <form method="GET" action="/readings" className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="E&C or vehicle no. e.g. HEX-11 / ZB-2587"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-10 pr-3 py-2.5 text-white placeholder-gray-500 text-xs focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl py-2.5 active:scale-95 transition-all shadow-md"
            >
              Filter Log
            </button>
            <Link
              href="/readings"
              className="px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center border border-white/5 active:scale-95 transition-all"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {/* Readings Table */}
      {readings.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-16 text-center text-xs text-gray-500">
          No meter readings found matching search criteria.
        </div>
      ) : (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Asset Code</th>
                <th className="px-6 py-4 font-semibold">Meter Type</th>
                <th className="px-6 py-4 font-semibold">Reading Value</th>
                <th className="px-6 py-4 font-semibold">Source / Status</th>
                <th className="px-6 py-4 font-semibold">Logged By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {readings.map((reading) => {
                const s = reading.source;
                const isGoogle = s === "GOOGLE_ESTIMATE";
                const isReset = s === "INSTRUMENT_RESET";
                const isResume = s === "REPAIR_RESUME";

                return (
                  <tr key={reading.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 text-gray-300 font-medium whitespace-nowrap">
                      {fmtDate(reading.readingDate)}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/fleet/${reading.asset.code}`}
                        className="font-bold text-white hover:text-indigo-400 tracking-wide transition-colors"
                      >
                        {reading.asset.code}
                      </Link>
                      {reading.asset.regNo && (
                        <span className="text-[10px] text-gray-500 block">{reading.asset.regNo}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Gauge className="w-3.5 h-3.5 text-gray-500" />
                        {reading.readingType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white font-bold font-mono text-sm whitespace-nowrap">
                      {reading.value.toLocaleString()} {reading.readingType}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isGoogle ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                          <MapPin className="w-2.5 h-2.5" />
                          GOOGLE ESTIMATE
                        </span>
                      ) : isReset ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 inline-flex items-center gap-1">
                          <RotateCcw className="w-2.5 h-2.5" />
                          NEW METER (RESET)
                        </span>
                      ) : isResume ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                          <Wrench className="w-2.5 h-2.5" />
                          REPAIRED RESUME
                        </span>
                      ) : (
                        <span className="bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400 border border-white/5">
                          {s.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {reading.recordedBy.name}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Record Reading */}
      {recordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Gauge className="w-4 h-4 text-indigo-400" />
                Record Meter Reading
              </h3>
              <button onClick={() => setRecordModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Select Vehicle
                </label>
                <select
                  required
                  value={selectedAssetId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedAssetId(id);
                    if (activeOutages.some((o) => o.asset.id === id)) {
                      setMeterStatus("BROKEN");
                    }
                  }}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                >
                  <option value="">Choose asset...</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.regNo ? `(${a.regNo})` : ""} — {a.meterType}
                    </option>
                  ))}
                </select>
              </div>

              {/* Meter Status Switch */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Physical Meter Condition
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMeterStatus("WORKING")}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      meterStatus === "WORKING"
                        ? "bg-indigo-600 text-white shadow"
                        : "bg-[#1b1e30] text-gray-400 hover:text-white"
                    }`}
                  >
                    <Gauge className="w-3.5 h-3.5" />
                    Working (Physical)
                  </button>

                  <button
                    type="button"
                    onClick={() => setMeterStatus("BROKEN")}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      meterStatus === "BROKEN"
                        ? "bg-amber-600 text-white shadow"
                        : "bg-[#1b1e30] text-gray-400 hover:text-white"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Broken (Google Est.)
                  </button>
                </div>

                {meterStatus === "BROKEN" && (
                  <p className="text-[11px] text-amber-300/80 mt-1.5">
                    This reading will be tagged as Google-estimated distance. Transparently labelled on bills and service intervals.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Reading Value {selectedAsset ? `(${selectedAsset.meterType})` : ""}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    value={readingVal}
                    onChange={(e) => setReadingVal(e.target.value)}
                    placeholder="e.g. 54200"
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={readingDate}
                    onChange={(e) => setReadingDate(e.target.value)}
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                  />
                </div>
              </div>

              {needsOverride && (
                <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-300">
                  <input
                    type="checkbox"
                    id="chkOverride"
                    checked={needsOverride}
                    onChange={(e) => setNeedsOverride(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <label htmlFor="chkOverride">Confirm lower reading (Admin Override)</label>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setRecordModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save Reading"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Report Broken Meter (Open Outage) */}
      {openOutageModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Report Broken Meter (Open Outage)
              </h3>
              <button onClick={() => setOpenOutageModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenOutage} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Select Vehicle
                </label>
                <select
                  required
                  value={outageAssetId}
                  onChange={(e) => setOutageAssetId(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                >
                  <option value="">Choose asset...</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.regNo ? `(${a.regNo})` : ""} — {a.meterType}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Outage Start Date
                </label>
                <input
                  type="date"
                  required
                  value={outageStartDate}
                  onChange={(e) => setOutageStartDate(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Reason / Defect Description
                </label>
                <textarea
                  rows={2}
                  value={outageReason}
                  onChange={(e) => setOutageReason(e.target.value)}
                  placeholder="e.g. Odometer cable snapped"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setOpenOutageModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {isPending ? "Opening..." : "Confirm Outage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Close Outage */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-emerald-400" />
                Close Meter Outage — {closeTarget.asset.code}
              </h3>
              <button onClick={() => setCloseTarget(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCloseOutage} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Resolution Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer text-xs transition-all ${
                    continuity === "repaired"
                      ? "bg-emerald-500/10 border-emerald-500 text-white font-bold"
                      : "bg-[#1b1e30] border-white/5 text-gray-400"
                  }`}>
                    <input
                      type="radio"
                      name="continuity"
                      value="repaired"
                      checked={continuity === "repaired"}
                      onChange={() => setContinuity("repaired")}
                      className="hidden"
                    />
                    <Wrench className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>Repaired</div>
                      <div className="text-[10px] font-normal text-gray-400">Resumes existing meter</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer text-xs transition-all ${
                    continuity === "replaced"
                      ? "bg-blue-500/10 border-blue-500 text-white font-bold"
                      : "bg-[#1b1e30] border-white/5 text-gray-400"
                  }`}>
                    <input
                      type="radio"
                      name="continuity"
                      value="replaced"
                      checked={continuity === "replaced"}
                      onChange={() => setContinuity("replaced")}
                      className="hidden"
                    />
                    <RotateCcw className="w-4 h-4 text-blue-400" />
                    <div>
                      <div>Replaced</div>
                      <div className="text-[10px] font-normal text-gray-400">Starts new meter epoch</div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  required
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Physical Reading on Resumption ({closeTarget.asset.meterType})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={endMeter}
                  onChange={(e) => setEndMeter(e.target.value)}
                  placeholder={
                    continuity === "replaced"
                      ? "Starting value on new meter (e.g. 0)"
                      : `Physical reading in ${closeTarget.asset.meterType}`
                  }
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Close Note (Optional)
                </label>
                <textarea
                  rows={2}
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="e.g. Replaced cable and tested"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setCloseTarget(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {isPending ? "Closing..." : "Close Outage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
