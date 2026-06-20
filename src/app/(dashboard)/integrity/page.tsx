import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { detectAnomalies, type AnomalyFinding } from "@/lib/integrity/anomalies";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { ShieldAlert, AlertTriangle, Fuel, Gauge } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-500/10 text-red-400 border-red-500/15",
  MEDIUM: "bg-amber-500/10 text-amber-400 border-amber-500/15",
  LOW: "bg-gray-500/10 text-gray-400 border-gray-500/15",
};

const TYPE_LABELS: Record<string, string> = {
  METER_UNDER_RECORDED: "Meter under-recorded",
  CONSUMPTION_SPIKE: "Consumption spike",
  DUPLICATE_REFUEL: "Duplicate refuel",
  BREAKDOWN_FUELING: "Fueled on breakdown day",
  METER_REGRESSION: "Meter regression",
};

export default async function IntegrityPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const sp = await props.searchParams;
  const now = new Date();
  const defFrom = currentMonthPeriod(now).start.toISOString().split("T")[0];
  const defTo = currentMonthPeriod(now).end.toISOString().split("T")[0];
  const fromStr = sp.from || defFrom;
  const toStr = sp.to || defTo;

  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);
  const scan = await detectAnomalies({ from, to });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-400" /> Fuel Integrity
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Cross-checks fuel issues against meters, rate cards and breakdown logs to surface anomalies.
          </p>
        </div>
        <form method="GET" action="/integrity" className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">From</label>
            <input type="date" name="from" defaultValue={fromStr} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">To</label>
            <input type="date" name="to" defaultValue={toStr} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">Scan</button>
        </form>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="High severity" value={scan.counts.high} className="text-red-400" icon={<ShieldAlert className="w-5 h-5" />} />
        <Kpi label="Medium" value={scan.counts.medium} className="text-amber-400" icon={<AlertTriangle className="w-5 h-5" />} />
        <Kpi label="Low" value={scan.counts.low} className="text-gray-300" icon={<Gauge className="w-5 h-5" />} />
        <Kpi label="Total findings" value={scan.counts.total} className="text-white" icon={<Fuel className="w-5 h-5" />} />
      </div>

      {/* Findings table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">Findings</h3>
        {scan.findings.length === 0 ? (
          <div className="text-center py-10 text-xs text-emerald-400">No anomalies detected in this period. ✓</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Severity</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5">Detail</th>
                <th className="py-2.5">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {scan.findings.map((f: AnomalyFinding, idx: number) => (
                <tr key={idx} className="hover:bg-white/[0.01] align-top">
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                  </td>
                  <td className="py-3">
                    <Link href={`/fleet/${f.assetCode}`} className="font-bold text-white hover:text-indigo-400">{f.assetCode}</Link>
                  </td>
                  <td className="py-3 text-gray-400">{f.projectName || "—"}</td>
                  <td className="py-3 text-gray-300 font-semibold">{TYPE_LABELS[f.type] || f.type}</td>
                  <td className="py-3 text-gray-400 max-w-[420px]">{f.message}</td>
                  <td className="py-3 text-gray-500 font-mono whitespace-nowrap">{f.date || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, className, icon }: { label: string; value: number; className: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md flex items-center gap-4">
      <div className={`w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center ${className}`}>{icon}</div>
      <div>
        <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">{label}</span>
        <span className={`text-lg font-bold block mt-0.5 ${className}`}>{value}</span>
      </div>
    </div>
  );
}
