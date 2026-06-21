import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getFleetServiceStatus } from "@/lib/service/fleet";
import { Wrench, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const STATE_STYLES: Record<string, string> = {
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/15",
  DUE_SOON: "bg-amber-500/10 text-amber-400 border-amber-500/15",
  OK: "bg-emerald-500/10 text-emerald-400 border-emerald-500/15",
  UNKNOWN: "bg-gray-500/10 text-gray-400 border-gray-500/15",
};

function num(n: number | null, frac = 0) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: frac });
}
function date(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default async function ServicePage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const projectId = session.role === "USER" ? session.projectId ?? undefined : undefined;
  const sp = await props.searchParams;
  const statusFilter = (sp.status || "").toUpperCase();

  const { rows, counts } = await getFleetServiceStatus({ projectId });
  const filtered = statusFilter && STATE_STYLES[statusFilter] ? rows.filter((r) => r.state === statusFilter) : rows;

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Wrench className="w-5 h-5 text-indigo-400" /> Service Planner
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Service is due on the <strong>higher</strong> of recorded meter growth and fuel-derived running since the last service (machinery 500 hr · road 5,000 km, editable).
        </p>
      </div>

      {/* KPI / filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FilterCard href="/service?status=OVERDUE" active={statusFilter === "OVERDUE"} label="Overdue" value={counts.overdue} className="text-red-400" icon={<AlertTriangle className="w-5 h-5" />} />
        <FilterCard href="/service?status=DUE_SOON" active={statusFilter === "DUE_SOON"} label="Due soon" value={counts.dueSoon} className="text-amber-400" icon={<Clock className="w-5 h-5" />} />
        <FilterCard href="/service?status=OK" active={statusFilter === "OK"} label="OK" value={counts.ok} className="text-emerald-400" icon={<CheckCircle2 className="w-5 h-5" />} />
        <FilterCard href="/service" active={!statusFilter} label="Tracked" value={counts.tracked} className="text-white" icon={<Wrench className="w-5 h-5" />} />
      </div>

      {/* Table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No vehicles match.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5 text-right">Interval</th>
                <th className="py-2.5 text-right">Recorded</th>
                <th className="py-2.5 text-right">Fuel-derived</th>
                <th className="py-2.5 text-right">Used</th>
                <th className="py-2.5 text-right">Remaining</th>
                <th className="py-2.5">Projected due</th>
                <th className="py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((r) => {
                const unit = r.basis === "KM" ? "km" : "hr";
                return (
                  <tr key={r.assetId} className="hover:bg-white/[0.01]">
                    <td className="py-3">
                      <Link href={`/fleet/${r.code}?tab=service`} className="font-bold text-white hover:text-indigo-400">{r.code}</Link>
                      <span className="block text-[10px] text-gray-500">{r.categoryName}</span>
                    </td>
                    <td className="py-3 text-gray-400">{r.projectName || "—"}</td>
                    <td className="py-3 text-right text-gray-300">{num(r.intervalValue)} {unit}<span className="block text-[9px] text-gray-600 uppercase">{r.intervalSource}</span></td>
                    <td className="py-3 text-right text-gray-400 font-mono">{num(r.recordedSince)}</td>
                    <td className="py-3 text-right text-gray-400 font-mono">{r.fuelDerivedSince == null ? "—" : num(r.fuelDerivedSince)}</td>
                    <td className="py-3 text-right text-white font-semibold">{num(r.usedSince)} {r.usedSince != null ? unit : ""}</td>
                    <td className={`py-3 text-right font-bold ${r.remaining != null && r.remaining <= 0 ? "text-red-400" : "text-gray-200"}`}>{num(r.remaining)}</td>
                    <td className="py-3 text-gray-400 whitespace-nowrap">{date(r.projectedDueDate)}</td>
                    <td className="py-3"><span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${STATE_STYLES[r.state]}`}>{r.state.replace("_", " ")}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilterCard({ href, active, label, value, className, icon }: { href: string; active: boolean; label: string; value: number; className: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className={`bg-[#121420] border rounded-2xl p-5 shadow-md flex items-center gap-4 transition-all ${active ? "border-indigo-500/40" : "border-white/5 hover:border-white/10"}`}>
      <div className={`w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center ${className}`}>{icon}</div>
      <div>
        <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">{label}</span>
        <span className={`text-lg font-bold block mt-0.5 ${className}`}>{value}</span>
      </div>
    </Link>
  );
}
