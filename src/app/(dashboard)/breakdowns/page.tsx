import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getBreakdownEpisodes } from "@/lib/breakdowns";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { AlertTriangle, CheckCircle2, Clock, Wrench } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ ym?: string; site?: string }>;
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthTitle(ym: string) {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function fmtDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function BreakdownsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const sp = await props.searchParams;
  const ym = sp.ym && YM_RE.test(sp.ym) ? sp.ym : currentMonthPeriod().periodKey;
  const period = resolvePeriod(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));

  const isSiteUser = session.role === "USER" && !!session.projectId;
  const projects = isSiteUser ? [] : await prisma.project.findMany({ orderBy: { name: "asc" } });
  const siteFilter = isSiteUser
    ? session.projectId!
    : sp.site && projects.some((p) => p.id === sp.site)
      ? sp.site
      : undefined;

  const log = await getBreakdownEpisodes({ from: period.start, to: period.end, projectId: siteFilter });
  const history = log.episodes;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" /> Breakdown Log
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Machine downtime derived from the daily condition log — consecutive breakdown days form one episode; a working day or a logging gap closes it.
          </p>
        </div>
        <form method="GET" action="/breakdowns" className="flex items-end gap-2">
          {!isSiteUser && (
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Site</label>
              <select name="site" defaultValue={siteFilter ?? ""} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
                <option value="">All sites</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Month</label>
            <input type="month" name="ym" defaultValue={ym} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="Down right now" value={`${log.stats.assetsDownNow}`} className={log.stats.assetsDownNow > 0 ? "text-rose-400" : "text-emerald-400"} />
        <Kpi label={`Downtime days (${monthTitle(ym)})`} value={`${log.stats.downtimeDaysInWindow}`} className="text-amber-400" />
        <Kpi label="Episodes closed" value={`${log.stats.closedCount}`} className="text-gray-300" />
        <Kpi label="Avg days to repair" value={log.stats.avgRepairDays != null ? log.stats.avgRepairDays.toFixed(1) : "—"} className="text-white" />
      </div>

      {/* Down now */}
      <Section title="Down now" icon={<AlertTriangle className="w-4 h-4 text-rose-400" />}>
        {log.openNow.length === 0 ? (
          <div className="text-center py-8 text-xs text-emerald-400 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> No machines are logged as broken down.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Machine</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5">Down since</th>
                <th className="py-2.5 text-right pr-6">Days logged down</th>
                <th className="py-2.5">Last log</th>
                <th className="py-2.5">Last note</th>
                <th className="py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {log.openNow.map((e) => (
                <tr key={`${e.assetId}-${e.startDay}`} className="hover:bg-white/[0.01]">
                  <td className="py-3"><Link href={`/fleet/${e.code}`} className="font-bold text-white hover:text-indigo-400">{e.code}</Link></td>
                  <td className="py-3 text-gray-400">{e.projectName ?? "—"}</td>
                  <td className="py-3 text-gray-400">{e.categoryName ?? "—"}</td>
                  <td className="py-3 text-gray-300">{fmtDay(e.startDay)}</td>
                  <td className="py-3 text-right font-bold text-rose-400 pr-6">{e.days}</td>
                  <td className="py-3 text-gray-500">{fmtDay(e.lastLoggedDay)}</td>
                  <td className="py-3 text-gray-500 max-w-[240px] truncate" title={e.lastNote ?? ""}>{e.lastNote ?? "—"}</td>
                  <td className="py-3 text-right">
                    <Link href={`/fleet/${e.code}?tab=service`} className="text-[10px] font-bold text-indigo-400 hover:underline whitespace-nowrap">
                      <Wrench className="w-3 h-3 inline mr-1" />log service
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* History */}
      <Section title={`Episodes in ${monthTitle(ym)}`} icon={<Clock className="w-4 h-4 text-indigo-400" />}>
        {history.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-500">No breakdown episodes touch this month.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Machine</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5">From</th>
                <th className="py-2.5">To</th>
                <th className="py-2.5 text-right pr-6">Days</th>
                <th className="py-2.5">Status</th>
                <th className="py-2.5">Last note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((e) => (
                <tr key={`${e.assetId}-${e.startDay}`} className="hover:bg-white/[0.01]">
                  <td className="py-3"><Link href={`/fleet/${e.code}`} className="font-bold text-white hover:text-indigo-400">{e.code}</Link></td>
                  <td className="py-3 text-gray-400">{e.projectName ?? "—"}</td>
                  <td className="py-3 text-gray-300">{fmtDay(e.startDay)}</td>
                  <td className="py-3 text-gray-300">{fmtDay(e.endDay)}</td>
                  <td className="py-3 text-right font-bold text-amber-400 pr-6">{e.days}</td>
                  <td className="py-3">
                    {e.open ? (
                      <span className="text-[10px] font-bold rounded-lg px-2 py-1 bg-rose-500/10 text-rose-400">STILL DOWN</span>
                    ) : (
                      <span className="text-[10px] font-bold rounded-lg px-2 py-1 bg-emerald-500/10 text-emerald-400">REPAIRED</span>
                    )}
                  </td>
                  <td className="py-3 text-gray-500 max-w-[280px] truncate" title={e.lastNote ?? ""}>{e.lastNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <p className="text-[11px] text-gray-500">
        Billing already deducts these days automatically (breakdown deduction on the monthly bill); this log is the operational view of the same flags.
      </p>
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
