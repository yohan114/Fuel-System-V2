import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getFleetUtilization } from "@/lib/analytics/utilization";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { Activity, TrendingDown, Wrench } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

export default async function AnalyticsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const projectId = session.role === "USER" ? session.projectId ?? undefined : undefined;

  const sp = await props.searchParams;
  const now = new Date();
  const cur = currentMonthPeriod(now);
  const fromStr = sp.from || cur.start.toISOString().split("T")[0];
  const toStr = sp.to || cur.end.toISOString().split("T")[0];
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);

  const rows = await getFleetUtilization({ from, to, projectId });
  const utilization = [...rows].sort((a, b) => a.utilizationPct - b.utilizationPct);
  const downtime = rows.filter((r) => r.breakdownDays > 0).sort((a, b) => b.breakdownDays - a.breakdownDays);

  const totalWorking = rows.reduce((a, r) => a + r.workingDays, 0);
  const totalBreakdown = rows.reduce((a, r) => a + r.breakdownDays, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" /> Utilization & Downtime
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Working vs idle days and breakdown downtime, from the daily condition logs.{" "}
            <Link href="/analytics/consumption" className="text-indigo-400 hover:underline">Fuel consumption health →</Link>
          </p>
        </div>
        <form method="GET" action="/analytics" className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">From</label>
            <input type="date" name="from" defaultValue={fromStr} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">To</label>
            <input type="date" name="to" defaultValue={toStr} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Kpi label="Vehicles tracked" value={`${rows.length}`} className="text-white" />
        <Kpi label="Total working days" value={`${totalWorking}`} className="text-emerald-400" />
        <Kpi label="Total breakdown days" value={`${totalBreakdown}`} className="text-red-400" />
      </div>

      {/* Utilization (under-utilized first) */}
      <Section title="Utilization (lowest first)" icon={<TrendingDown className="w-4 h-4 text-amber-400" />}>
        {utilization.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5 text-right">Working days</th>
                <th className="py-2.5 text-right">Meter Δ</th>
                <th className="py-2.5 text-right">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {utilization.slice(0, 40).map((r) => (
                <tr key={r.assetId} className="hover:bg-white/[0.01]">
                  <td className="py-3"><Link href={`/fleet/${r.code}`} className="font-bold text-white hover:text-indigo-400">{r.code}</Link></td>
                  <td className="py-3 text-gray-400">{r.projectName || "—"}</td>
                  <td className="py-3 text-right text-gray-300">{r.workingDays}</td>
                  <td className="py-3 text-right text-gray-400 font-mono">{r.meterDelta > 0 ? `${r.meterDelta.toLocaleString()} ${r.meterType}` : "—"}</td>
                  <td className={`py-3 text-right font-bold ${r.utilizationPct < 0.3 ? "text-amber-400" : "text-emerald-400"}`}>{pct(r.utilizationPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Downtime */}
      <Section title="Downtime (most breakdown days first)" icon={<Wrench className="w-4 h-4 text-red-400" />}>
        {downtime.length === 0 ? (
          <div className="text-center py-8 text-xs text-emerald-400">No breakdown days logged in this period. ✓</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5 text-right">Breakdown days</th>
                <th className="py-2.5 text-right">Logged days</th>
                <th className="py-2.5 text-right">Downtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {downtime.map((r) => (
                <tr key={r.assetId} className="hover:bg-white/[0.01]">
                  <td className="py-3"><Link href={`/fleet/${r.code}`} className="font-bold text-white hover:text-indigo-400">{r.code}</Link></td>
                  <td className="py-3 text-gray-400">{r.projectName || "—"}</td>
                  <td className="py-3 text-right text-red-400 font-bold">{r.breakdownDays}</td>
                  <td className="py-3 text-right text-gray-400">{r.loggedDays}</td>
                  <td className="py-3 text-right font-bold text-amber-400">{pct(r.downtimePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md">
      <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">{label}</span>
      <span className={`text-lg font-bold block mt-0.5 ${className}`}>{value}</span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2 flex items-center gap-2">{icon}{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-center py-8 text-xs text-gray-500">No condition logs in this period.</div>;
}
