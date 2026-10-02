"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  openMeterOutageAction,
  closeMeterOutageAction,
  cancelMeterOutageAction,
  editMeterOutageAction,
} from "@/app/actions/meter-outage";
import {
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Search,
  Calendar,
  X,
  Edit2,
  Trash2,
  Clock,
  Wrench,
  RotateCcw,
} from "lucide-react";

interface OutageRow {
  id: string;
  startDate: Date;
  endDate: Date | null;
  reason: string | null;
  endPhysicalMeter: number | null;
  instrumentContinuity: string | null;
  closeNote: string | null;
  asset: {
    id: string;
    code: string;
    regNo: string | null;
    meterType: string;
    typeLabel: string | null;
  };
  openedBy: {
    id: string;
    name: string;
    username: string;
  };
  closedBy: {
    id: string;
    name: string;
    username: string;
  } | null;
}

interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
}

export default function MeterOutagesClient({
  initialOutages,
  assets,
}: {
  initialOutages: OutageRow[];
  assets: AssetOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "CLOSED">("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals state
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<OutageRow | null>(null);
  const [editTarget, setEditTarget] = useState<OutageRow | null>(null);

  // Form states for Open Outage
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [openReason, setOpenReason] = useState("");

  // Form states for Close Outage
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [continuity, setContinuity] = useState<"repaired" | "replaced">("repaired");
  const [endMeter, setEndMeter] = useState("");
  const [closeNote, setCloseNote] = useState("");

  const activeCount = initialOutages.filter((o) => o.endDate === null).length;
  const closedCount = initialOutages.filter((o) => o.endDate !== null).length;

  const filtered = initialOutages.filter((o) => {
    if (filterStatus === "ACTIVE" && o.endDate !== null) return false;
    if (filterStatus === "CLOSED" && o.endDate === null) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const codeMatch = o.asset.code.toLowerCase().includes(q);
      const regMatch = o.asset.regNo ? o.asset.regNo.toLowerCase().includes(q) : false;
      const reasonMatch = o.reason ? o.reason.toLowerCase().includes(q) : false;
      return codeMatch || regMatch || reasonMatch;
    }
    return true;
  });

  const handleOpenOutage = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const fd = new FormData();
    fd.append("assetId", selectedAssetId);
    fd.append("startDate", startDate);
    if (openReason) fd.append("reason", openReason);

    startTransition(async () => {
      const res = await openMeterOutageAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess("Meter outage opened successfully");
        setOpenModalOpen(false);
        setSelectedAssetId("");
        setOpenReason("");
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

  const handleCancelOutage = (outageId: string, assetCode: string) => {
    if (!confirm(`Are you sure you want to cancel and delete the outage record for ${assetCode}? This should only be used if it was opened by mistake.`)) {
      return;
    }
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await cancelMeterOutageAction(outageId);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`Cancelled outage record for ${assetCode}`);
        router.refresh();
      }
    });
  };

  const handleEditOutage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setError(null);
    setSuccess(null);

    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    fd.append("outageId", editTarget.id);

    startTransition(async () => {
      const res = await editMeterOutageAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`Updated outage record for ${editTarget.asset.code}`);
        setEditTarget(null);
        router.refresh();
      }
    });
  };

  function fmtDate(d: Date | string | null): string {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function getDays(start: Date | string, end: Date | string | null): number {
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Gauge className="w-5 h-5 text-indigo-400" />
            Meter Outages & Instrument Tracking
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Track vehicles with broken odometers/hour meters. Distance during outages is recorded via Google Maps estimates and audited.
          </p>
        </div>

        <button
          onClick={() => setOpenModalOpen(true)}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          Open Meter Outage
        </button>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 font-medium">Active Outages</div>
            <div className="text-2xl font-bold text-amber-400 mt-1 flex items-center gap-2">
              {activeCount}
              {activeCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
              )}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">Meters currently down</div>
          </div>
          <AlertTriangle className="w-8 h-8 text-amber-400/20" />
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 font-medium">Resolved Outages</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{closedCount}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Repaired or replaced meters</div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-400/20" />
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 font-medium">Total Lifetime Outages</div>
            <div className="text-2xl font-bold text-white mt-1">{initialOutages.length}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Recorded across fleet</div>
          </div>
          <Clock className="w-8 h-8 text-white/10" />
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl p-3.5 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4 text-red-400 hover:text-white" />
          </button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl p-3.5 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)}>
            <X className="w-4 h-4 text-emerald-400 hover:text-white" />
          </button>
        </div>
      )}

      {/* Filters and Search Bar */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle code or reason..."
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 text-xs focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {(["ALL", "ACTIVE", "CLOSED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === s
                  ? "bg-indigo-600 text-white shadow"
                  : "bg-white/5 hover:bg-white/10 text-gray-400"
              }`}
            >
              {s === "ALL" ? "All Outages" : s === "ACTIVE" ? `Active (${activeCount})` : `Closed (${closedCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-14 text-center text-xs text-gray-500">
          No meter outage records found matching your filters.
        </div>
      ) : (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                  <th className="px-5 py-3.5 font-semibold">Vehicle</th>
                  <th className="px-5 py-3.5 font-semibold">Outage Period</th>
                  <th className="px-5 py-3.5 font-semibold">Duration</th>
                  <th className="px-5 py-3.5 font-semibold">Resolution</th>
                  <th className="px-5 py-3.5 font-semibold">Closing Meter</th>
                  <th className="px-5 py-3.5 font-semibold">Reason & Notes</th>
                  <th className="px-5 py-3.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((outage) => {
                  const isActive = outage.endDate === null;
                  const days = getDays(outage.startDate, outage.endDate);

                  return (
                    <tr key={outage.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="font-bold text-white tracking-wide">{outage.asset.code}</div>
                        <div className="text-[10px] text-gray-400">
                          {outage.asset.regNo || outage.asset.typeLabel || "Vehicle"} • {outage.asset.meterType}
                        </div>
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-gray-300">
                          <span>{fmtDate(outage.startDate)}</span>
                          <span className="text-gray-500">→</span>
                          {isActive ? (
                            <span className="text-amber-400 font-semibold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              Active Outage
                            </span>
                          ) : (
                            <span>{fmtDate(outage.endDate)}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Opened by {outage.openedBy.name}
                        </div>
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          isActive
                            ? days > 14
                              ? "bg-red-500/20 text-red-300 border border-red-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-white/5 text-gray-400 border border-white/5"
                        }`}>
                          {days} {days === 1 ? "day" : "days"}
                        </span>
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {isActive ? (
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-400/10 text-amber-300 border border-amber-400/20">
                            Meter Broken
                          </span>
                        ) : outage.instrumentContinuity === "replaced" ? (
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1 w-fit">
                            <RotateCcw className="w-3 h-3" />
                            New Meter
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
                            <Wrench className="w-3 h-3" />
                            Repaired
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap font-mono">
                        {outage.endPhysicalMeter !== null ? (
                          <span className="text-white font-bold">
                            {outage.endPhysicalMeter.toLocaleString()} {outage.asset.meterType}
                          </span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4 max-w-xs truncate">
                        {outage.reason && (
                          <div className="text-gray-300 truncate" title={outage.reason}>
                            {outage.reason}
                          </div>
                        )}
                        {outage.closeNote && (
                          <div className="text-[10px] text-gray-500 truncate" title={outage.closeNote}>
                            Close: {outage.closeNote}
                          </div>
                        )}
                        {!outage.reason && !outage.closeNote && (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isActive && (
                            <button
                              onClick={() => {
                                setCloseTarget(outage);
                                setCloseDate(new Date().toISOString().slice(0, 10));
                                setContinuity("repaired");
                                setEndMeter("");
                                setCloseNote("");
                              }}
                              className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[11px] font-semibold transition-all border border-emerald-500/30"
                            >
                              Close Outage
                            </button>
                          )}

                          <button
                            onClick={() => setEditTarget(outage)}
                            title="Edit Outage"
                            className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleCancelOutage(outage.id, outage.asset.code)}
                            title="Cancel / Delete Outage"
                            className="p-1.5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Open Meter Outage */}
      {openModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Report Broken Meter (Open Outage)
              </h3>
              <button
                onClick={() => setOpenModalOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-400">
              When a meter outage is opened, distance for this vehicle can be logged from Google Maps estimates without breaking cumulative continuity.
            </p>

            <form onSubmit={handleOpenOutage} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Select Vehicle
                </label>
                <select
                  required
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
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
                  Outage Start Date (Colombo)
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Reason / Defect Description
                </label>
                <textarea
                  rows={2}
                  value={openReason}
                  onChange={(e) => setOpenReason(e.target.value)}
                  placeholder="e.g. Odometer cable snapped / Digital display dead"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setOpenModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {isPending ? "Opening..." : "Confirm Open Outage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Close Meter Outage */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-emerald-400" />
                Close Meter Outage — {closeTarget.asset.code}
              </h3>
              <button
                onClick={() => setCloseTarget(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-400">
              Outage started on {fmtDate(closeTarget.startDate)}. Specify whether the instrument was repaired (resumes previous reading) or replaced with a new instrument.
            </p>

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
                  End Date (Date Back in Service)
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
                      ? "Starting value on new meter (e.g. 0 or initial reading)"
                      : `Physical reading in ${closeTarget.asset.meterType}`
                  }
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {continuity === "replaced"
                    ? "Writes an INSTRUMENT_RESET reading to establish the baseline for the new meter epoch."
                    : "Writes a REPAIR_RESUME reading to record the physical resumption."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Resolution Note (Optional)
                </label>
                <textarea
                  rows={2}
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="e.g. Replaced speedometer sensor and calibrated"
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

      {/* Modal: Edit Meter Outage */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-400" />
                Edit Outage — {editTarget.asset.code}
              </h3>
              <button
                onClick={() => setEditTarget(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditOutage} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    name="startDate"
                    required
                    defaultValue={new Date(editTarget.startDate).toISOString().slice(0, 10)}
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={editTarget.endDate ? new Date(editTarget.endDate).toISOString().slice(0, 10) : ""}
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Continuity Status
                </label>
                <select
                  name="instrumentContinuity"
                  defaultValue={editTarget.instrumentContinuity || ""}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                >
                  <option value="">(None / Still Open)</option>
                  <option value="repaired">Repaired (Resumes meter)</option>
                  <option value="replaced">Replaced (New instrument epoch)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  End Physical Reading
                </label>
                <input
                  type="number"
                  step="0.1"
                  name="endPhysicalMeter"
                  defaultValue={editTarget.endPhysicalMeter ?? ""}
                  placeholder="Physical reading at close"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Reason
                </label>
                <input
                  type="text"
                  name="reason"
                  defaultValue={editTarget.reason || ""}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Close Note
                </label>
                <input
                  type="text"
                  name="closeNote"
                  defaultValue={editTarget.closeNote || ""}
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
