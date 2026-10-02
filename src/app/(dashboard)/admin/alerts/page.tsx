import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { collectAlerts } from "@/lib/alerts/collect";
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Sliders,
} from "lucide-react";

export default async function AdminAlertsPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const alerts = await collectAlerts({ isAdmin: true });

  const highAlerts = alerts.filter((a) => a.severity === "HIGH");
  const mediumAlerts = alerts.filter((a) => a.severity === "MEDIUM");
  const lowAlerts = alerts.filter((a) => a.severity === "LOW");

  const severityBadge = (sev: "HIGH" | "MEDIUM" | "LOW") => {
    switch (sev) {
      case "HIGH":
        return "bg-rose-500/10 border-rose-500/20 text-rose-400";
      case "MEDIUM":
        return "bg-amber-500/10 border-amber-500/20 text-amber-400";
      case "LOW":
        return "bg-indigo-500/10 border-indigo-500/20 text-indigo-400";
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-400" /> Operational Alerts & Health Monitor
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Real-time anomalies, approval bottlenecks, billing discrepancies, and storage tank shortfalls that require administrator intervention.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Critical (High)
            </span>
            <AlertCircle className="w-5 h-5 text-rose-400" />
          </div>
          <span className="text-2xl font-bold text-rose-400 block mt-2">
            {highAlerts.length}
          </span>
          <span className="text-[11px] text-gray-500 mt-0.5 block">
            Requires immediate action
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Warnings (Medium)
            </span>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <span className="text-2xl font-bold text-amber-400 block mt-2">
            {mediumAlerts.length}
          </span>
          <span className="text-[11px] text-gray-500 mt-0.5 block">
            Pending reviews or overdue milestones
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Advisories (Low)
            </span>
            <Info className="w-5 h-5 text-indigo-400" />
          </div>
          <span className="text-2xl font-bold text-indigo-400 block mt-2">
            {lowAlerts.length}
          </span>
          <span className="text-[11px] text-gray-500 mt-0.5 block">
            Data hygiene & reminders
          </span>
        </div>
      </div>

      {/* Alerts Feed */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl space-y-4 p-6">
        <h3 className="text-sm font-bold text-white tracking-wide border-b border-white/5 pb-3 flex items-center justify-between">
          <span>Active Alerts Feed ({alerts.length})</span>
          {alerts.length === 0 && (
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> All Systems Nominal
            </span>
          )}
        </h3>

        {alerts.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500">
            No active operational alerts detected across fleet, fuel, or billing.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {alerts.map((alert) => (
              <div
                key={alert.key}
                className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-white/[0.01] transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold border ${severityBadge(
                        alert.severity
                      )}`}
                    >
                      {alert.severity}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[9px] font-semibold bg-white/5 border border-white/10 text-gray-400">
                      {alert.category}
                    </span>
                    <span className="text-xs font-bold text-white">{alert.title}</span>
                  </div>
                  <p className="text-xs text-gray-400">{alert.detail}</p>
                </div>

                <Link
                  href={alert.href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 text-xs font-semibold border border-indigo-500/20 transition-all shrink-0"
                >
                  Review Item <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Threshold Configuration Card */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-white/5 pb-2 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-gray-500" /> Operational Alert Thresholds
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-1">
            <span className="text-gray-400 font-semibold block">Bulk Tank Low Warning</span>
            <span className="text-white font-bold text-sm block">Balance &lt; 20% Capacity</span>
            <p className="text-[11px] text-gray-500">
              Flags bulk tank cards in yellow when available fuel drops below reserve volume.
            </p>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-1">
            <span className="text-gray-400 font-semibold block">Bulk Dip Shortfall</span>
            <span className="text-white font-bold text-sm block">Variance &gt; 2% or 5 Litres</span>
            <p className="text-[11px] text-gray-500">
              Flags potential shrinkage or unrecorded fuel draws on physical dip recordings.
            </p>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-1">
            <span className="text-gray-400 font-semibold block">Service Overdue Notice</span>
            <span className="text-white font-bold text-sm block">Within 7 Days / 50 Hours</span>
            <p className="text-[11px] text-gray-500">
              Flags vehicles approaching their next scheduled PM service milestone.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
