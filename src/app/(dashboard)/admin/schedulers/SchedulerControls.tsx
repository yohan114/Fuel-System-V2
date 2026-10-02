"use client";

import React, { useState } from "react";
import {
  triggerPriceSyncAction,
  triggerWorkshopSyncAction,
  updateSchedulerConfigAction,
} from "@/app/actions/schedulers";
import { runOnDemandBackupAction } from "@/app/actions/admin";
import { Play, Loader2, CheckCircle2, AlertCircle, RefreshCw, Save } from "lucide-react";

interface SchedulerControlsProps {
  scraperEnabled: boolean;
  scraperCron: string;
  serviceSyncEnabled: boolean;
  backupCron: string;
  backupRetentionDays: string;
  lastScraperSync: string | null;
  lastServiceRun: string | null;
  lastBackupDate: string | null;
}

export function SchedulerControls({
  scraperEnabled,
  scraperCron,
  serviceSyncEnabled,
  backupCron,
  backupRetentionDays,
  lastScraperSync,
  lastServiceRun,
  lastBackupDate,
}: SchedulerControlsProps) {
  const [running, setRunning] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleSyncPrice = async () => {
    setRunning("price");
    setStatusMsg(null);
    try {
      const res = await triggerPriceSyncAction();
      if (res.error) setStatusMsg({ type: "err", text: res.error });
      else setStatusMsg({ type: "ok", text: res.message || "Price sync complete!" });
    } catch {
      setStatusMsg({ type: "err", text: "Failed to trigger price sync" });
    } finally {
      setRunning(null);
    }
  };

  const handleSyncWorkshop = async () => {
    setRunning("workshop");
    setStatusMsg(null);
    try {
      const res = await triggerWorkshopSyncAction();
      if (res.error) setStatusMsg({ type: "err", text: res.error });
      else setStatusMsg({ type: "ok", text: res.message || "Workshop sync complete!" });
    } catch {
      setStatusMsg({ type: "err", text: "Failed to trigger workshop sync" });
    } finally {
      setRunning(null);
    }
  };

  const handleRunBackup = async () => {
    setRunning("backup");
    setStatusMsg(null);
    try {
      const res = await runOnDemandBackupAction();
      if (res.error) setStatusMsg({ type: "err", text: res.error });
      else setStatusMsg({ type: "ok", text: "Hot database backup completed successfully." });
    } catch {
      setStatusMsg({ type: "err", text: "Failed to trigger backup" });
    } finally {
      setRunning(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRunning("config");
    setStatusMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await updateSchedulerConfigAction(fd);
      if (res.error) setStatusMsg({ type: "err", text: res.error });
      else setStatusMsg({ type: "ok", text: "Scheduler configuration saved." });
    } catch {
      setStatusMsg({ type: "err", text: "Failed to save configuration" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2 text-xs border ${
            statusMsg.type === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}
        >
          {statusMsg.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Manual Immediate Triggers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Scraper Card */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Ceypetco Price Scraper</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Daily automated price refresh</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                scraperEnabled
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-gray-500/10 text-gray-400 border border-gray-500/20"
              }`}
            >
              {scraperEnabled ? "ENABLED" : "PAUSED"}
            </span>
          </div>

          <div className="text-xs text-gray-400 space-y-1">
            <div>Schedule: <span className="text-gray-200 font-mono">{scraperCron}</span></div>
            <div>Last run: <span className="text-gray-200">{lastScraperSync || "Never"}</span></div>
          </div>

          <button
            onClick={handleSyncPrice}
            disabled={running !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
          >
            {running === "price" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Sync Prices Now
          </button>
        </div>

        {/* WorkshopOne Sync Card */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">WorkshopOne Service Sync</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">In-process 5-min service poller</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                serviceSyncEnabled
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-gray-500/10 text-gray-400 border border-gray-500/20"
              }`}
            >
              {serviceSyncEnabled ? "ACTIVE" : "DISABLED"}
            </span>
          </div>

          <div className="text-xs text-gray-400 space-y-1">
            <div>Frequency: <span className="text-gray-200">Every 5 minutes</span></div>
            <div>Last sync: <span className="text-gray-200">{lastServiceRun ? new Date(lastServiceRun).toLocaleTimeString() : "Recent"}</span></div>
          </div>

          <button
            onClick={handleSyncWorkshop}
            disabled={running !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
          >
            {running === "workshop" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Sync Services Now
          </button>
        </div>

        {/* Nightly DB Backup Card */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Database Hot Backup</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Automated SQLite VACUUM INTO</p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ACTIVE
            </span>
          </div>

          <div className="text-xs text-gray-400 space-y-1">
            <div>Schedule: <span className="text-gray-200 font-mono">{backupCron}</span></div>
            <div>Last backup: <span className="text-gray-200">{lastBackupDate || "Recent"}</span></div>
          </div>

          <button
            onClick={handleRunBackup}
            disabled={running !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
          >
            {running === "backup" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run Hot Backup Now
          </button>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 space-y-4 shadow-xl">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-white/5 pb-2">
          Scheduler Timing & Retention Settings
        </h3>

        <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Ceypetco Scraper Active
            </label>
            <select
              name="scraperEnabled"
              defaultValue={scraperEnabled ? "true" : "false"}
              className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="true">Enabled</option>
              <option value="false">Paused / Disabled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Ceypetco Cron Schedule
            </label>
            <input
              type="text"
              name="scraperCron"
              defaultValue={scraperCron}
              placeholder="0 6 * * *"
              className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              WorkshopOne Sync Active
            </label>
            <select
              name="serviceSyncEnabled"
              defaultValue={serviceSyncEnabled ? "true" : "false"}
              className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="true">Enabled (Every 5 minutes)</option>
              <option value="false">Disabled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Nightly Backup Cron Schedule
            </label>
            <input
              type="text"
              name="backupCron"
              defaultValue={backupCron}
              placeholder="30 2 * * *"
              className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Backup Retention (Days)
            </label>
            <input
              type="number"
              name="backupRetentionDays"
              defaultValue={backupRetentionDays}
              min="1"
              max="365"
              className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-end justify-end">
            <button
              type="submit"
              disabled={running !== null}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
            >
              {running === "config" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
