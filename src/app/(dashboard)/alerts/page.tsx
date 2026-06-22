import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { collectAlerts, type Alert } from "@/lib/alerts/collect";
import { Bell, ArrowRight } from "lucide-react";

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-500/10 text-red-400 border-red-500/15",
  MEDIUM: "bg-amber-500/10 text-amber-400 border-amber-500/15",
  LOW: "bg-gray-500/10 text-gray-400 border-gray-500/15",
};

const CATEGORY_LABELS: Record<string, string> = {
  APPROVAL: "Approvals",
  INTEGRITY: "Integrity",
  BILLING: "Billing",
  DATA: "Data quality",
  TANK: "Bulk tanks",
  SERVICE: "Service",
};

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const projectId = session.role === "USER" ? session.projectId ?? undefined : undefined;
  const alerts = await collectAlerts({ projectId, isAdmin });

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-400" /> Alerts
          {alerts.length > 0 && (
            <span className="ml-1 bg-amber-500/15 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full">{alerts.length}</span>
          )}
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Live operational alerts — pending approvals, overdue invoices, integrity findings, low tanks and missing data. Items clear automatically once handled.
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-[#121420] border border-emerald-500/10 rounded-2xl py-16 text-center text-sm text-emerald-400">
          All clear — no open alerts. ✓
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a: Alert) => (
            <Link
              key={a.key}
              href={a.href}
              className="flex items-center justify-between gap-4 bg-[#121420] border border-white/5 hover:border-white/10 rounded-2xl p-4 md:p-5 shadow-md transition-all group"
            >
              <div className="flex items-start gap-4">
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${SEVERITY_STYLES[a.severity]} mt-0.5`}>{a.severity}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{a.title}</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-bold">{CATEGORY_LABELS[a.category]}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{a.detail}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-500 group-hover:text-white flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
