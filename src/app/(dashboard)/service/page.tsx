import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFleetServiceStatus } from "@/lib/service/fleet";
import { logServiceAction } from "@/app/actions/service";
import { Wrench, AlertTriangle, Clock, CheckCircle2, HelpCircle } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ status?: string; logged?: string; logerror?: string }>;
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
  const isAdmin = session.role === "ADMIN";
  const sp = await props.searchParams;
  const statusFilter = (sp.status || "").toUpperCase();

  const { rows, counts } = await getFleetServiceStatus({ projectId });
  const filtered = statusFilter && STATE_STYLES[statusFilter] ? rows.filter((r) => r.state === statusFilter) : rows;

  // Latest services logged across the (scoped) fleet.
  const recentServices = await prisma.serviceRecord.findMany({
    where: projectId ? { asset: { projectId } } : {},
    orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }],
    take: 10,
    include: { asset: { select: { code: true } }, recordedBy: { select: { name: true } } },
  });

  // Quick-log wrapper: logServiceAction accepts a vehicle code, so services
  // can be recorded straight from the planner without opening the asset page.
  async function quickLogAction(fd: FormData) {
    "use server";
    const code = fd.get("assetId")?.toString().trim().toUpperCase() || "";
    const res = await logServiceAction(fd);
    if (res?.error) redirect(`/service?logerror=${encodeURIComponent(res.error)}`);
    redirect(`/service?logged=${encodeURIComponent(code)}`);
  }

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

      {sp.logged && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Service logged for {sp.logged}. The countdown for this vehicle has been reset.
        </div>
      )}
      {sp.logerror && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Could not log service: {sp.logerror}
        </div>
      )}

      {/* KPI / filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <FilterCard href="/service?status=OVERDUE" active={statusFilter === "OVERDUE"} label="Overdue" value={counts.overdue} className="text-red-400" icon={<AlertTriangle className="w-5 h-5" />} />
        <FilterCard href="/service?status=DUE_SOON" active={statusFilter === "DUE_SOON"} label="Due soon" value={counts.dueSoon} className="text-amber-400" icon={<Clock className="w-5 h-5" />} />
        <FilterCard href="/service?status=OK" active={statusFilter === "OK"} label="OK" value={counts.ok} className="text-emerald-400" icon={<CheckCircle2 className="w-5 h-5" />} />
        <FilterCard href="/service?status=UNKNOWN" active={statusFilter === "UNKNOWN"} label="Unknown" value={counts.unknown} className="text-gray-400" icon={<HelpCircle className="w-5 h-5" />} />
        <FilterCard href="/service" active={!statusFilter} label="Tracked" value={counts.tracked} className="text-white" icon={<Wrench className="w-5 h-5" />} />
      </div>

      {/* Quick log — record a completed service without opening the vehicle page */}
      {isAdmin && (
        <form action={quickLogAction} className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-white/5 pb-2">
            <Wrench className="w-4 h-4 text-indigo-400" /> Log a Service
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <input type="text" name="assetId" required placeholder="Vehicle code e.g. DT-11" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="date" name="serviceDate" required defaultValue={new Date().toISOString().split("T")[0]} className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="number" step="0.1" name="meterAtService" placeholder="Meter at service" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="text" name="serviceType" placeholder="Type e.g. 500HR / Oil" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="text" name="jobNo" placeholder="Job No" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="number" step="0.01" name="costLkr" placeholder="Cost (LKR)" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="text" name="note" placeholder="Note (optional)" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2">Log service</button>
        </form>
      )}

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
                      <span className="block text-[10px] text-gray-500">
                        {r.categoryName}
                        {" · "}
                        <Link href={`/service/plan/${encodeURIComponent(r.code)}`} className="text-indigo-400 hover:underline">PM plan</Link>
                      </span>
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

      {/* Recently logged services */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-400" /> Recently Logged Services
        </h3>
        {recentServices.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-500">No services logged yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5 text-right">Meter</th>
                <th className="py-2.5 text-right pr-6">Cost</th>
                <th className="py-2.5">Note</th>
                <th className="py-2.5">Logged by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {recentServices.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-gray-300 whitespace-nowrap">{date(s.serviceDate)}</td>
                  <td className="py-3"><Link href={`/fleet/${s.asset.code}?tab=service`} className="font-bold text-white hover:text-indigo-400">{s.asset.code}</Link></td>
                  <td className="py-3 text-gray-300">{s.serviceType || "—"}</td>
                  <td className="py-3 text-right text-gray-400 font-mono">{s.meterAtService != null ? `${s.meterAtService.toLocaleString()} ${s.meterType}` : "—"}</td>
                  <td className="py-3 text-right text-gray-400 pr-6">{s.costCents != null ? `Rs ${(s.costCents / 100).toLocaleString("en-LK")}` : "—"}</td>
                  <td className="py-3 text-gray-500 max-w-[220px] truncate" title={s.note || ""}>{s.note || "—"}</td>
                  <td className="py-3 text-gray-400">{s.recordedBy.name}</td>
                </tr>
              ))}
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
