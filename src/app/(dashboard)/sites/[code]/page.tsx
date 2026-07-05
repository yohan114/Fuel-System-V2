import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { ArrowLeft, Building2, Target } from "lucide-react";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ ym?: string }>;
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fmtL(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtRs(cents: number) {
  return `Rs ${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function monthTitle(ym: string) {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

const FLAG_STYLE: Record<string, string> = {
  OK: "bg-emerald-500/10 text-emerald-400",
  METER_LOW: "bg-amber-500/10 text-amber-400",
  METER_HIGH: "bg-rose-500/10 text-rose-400",
};

export default async function SiteDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const { code: rawCode } = await props.params;
  const code = decodeURIComponent(rawCode);
  const project = await prisma.project.findUnique({ where: { code } });
  if (!project) redirect("/sites");

  // Site users can only open their own site.
  if (session.role === "USER" && session.projectId && session.projectId !== project.id) {
    redirect("/sites");
  }

  const sp = await props.searchParams;
  const ym = sp.ym && YM_RE.test(sp.ym) ? sp.ym : currentMonthPeriod().periodKey;
  const period = resolvePeriod(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));

  const [agg, budget] = await Promise.all([
    aggregateFuelData({ from: period.start, to: period.end, projectId: project.id }),
    prisma.budget.findUnique({
      where: { projectId_year_month: { projectId: project.id, year: period.year, month: period.month } },
    }),
  ]);

  const vehicleCount = agg.assetBreakdown.length;
  const maxTrend = Math.max(...agg.trend.map((t) => t.litres), 1);
  const maxCat = Math.max(...agg.categoryBreakdown.map((c) => c.litres), 1);
  const budgetPct = budget?.budgetLitres ? (agg.totalLitres / budget.budgetLitres) * 100 : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <Link href={`/sites?ym=${ym}`} className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 mb-1">
            <ArrowLeft className="w-3 h-3" /> All sites
          </Link>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-400" /> {project.name}
            <span className="text-[10px] font-mono text-gray-500 mt-1">{project.code}</span>
          </h1>
          <p className="text-xs text-gray-400 mt-1">Fuel activity in {monthTitle(ym)}.</p>
        </div>
        <form method="GET" action={`/sites/${encodeURIComponent(project.code)}`} className="flex items-center gap-2">
          <input type="month" name="ym" defaultValue={ym} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="Litres" value={`${fmtL(agg.totalLitres)} L`} className="text-white" />
        <Kpi label="Cost" value={fmtRs(agg.totalCostCents)} className="text-white" />
        <Kpi label="Issues / vehicles" value={`${agg.issueCount} / ${vehicleCount}`} className="text-gray-300" />
        <Kpi
          label="Budget usage"
          value={budget?.budgetLitres ? `${Math.round(budgetPct!)}% of ${fmtL(budget.budgetLitres)} L` : "No budget set"}
          className={budgetPct !== null && budgetPct > 100 ? "text-rose-400" : "text-emerald-400"}
        />
      </div>

      {/* Daily trend — single-series bars with native tooltips */}
      <Section title="Daily fuel drawn" icon={<Target className="w-4 h-4 text-indigo-400" />}>
        {agg.trend.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-end gap-[2px] h-24">
            {agg.trend.map((t) => (
              <div
                key={t.date}
                title={`${t.date}: ${fmtL(t.litres)} L (${fmtRs(t.costCents)})`}
                className="flex-1 min-w-[3px] rounded-t-[4px] bg-indigo-400/70 hover:bg-indigo-300"
                style={{ height: `${Math.max((t.litres / maxTrend) * 100, 2)}%` }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Category split */}
      <Section title="By category" icon={<Building2 className="w-4 h-4 text-indigo-400" />}>
        {agg.categoryBreakdown.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Category</th>
                <th className="py-2.5 w-1/3"></th>
                <th className="py-2.5 text-right">Litres</th>
                <th className="py-2.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {agg.categoryBreakdown.map((c) => (
                <tr key={c.code}>
                  <td className="py-2.5 text-gray-300">{c.name}</td>
                  <td className="py-2.5 pr-4">
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${(c.litres / maxCat) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-gray-300 font-mono">{fmtL(c.litres)}</td>
                  <td className="py-2.5 text-right text-gray-400">{fmtRs(c.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Assets */}
      <Section title="Vehicles & machines (by cost)" icon={<Building2 className="w-4 h-4 text-indigo-400" />}>
        {agg.assetBreakdown.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Litres</th>
                <th className="py-2.5 text-right">Cost</th>
                <th className="py-2.5 text-right">Meter Δ</th>
                <th className="py-2.5 text-right">Recommended</th>
                <th className="py-2.5 text-right">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {agg.assetBreakdown.slice(0, 60).map((a) => (
                <tr key={a.assetId} className="hover:bg-white/[0.01]">
                  <td className="py-2.5"><Link href={`/fleet/${a.code}`} className="font-bold text-white hover:text-indigo-400">{a.code}</Link></td>
                  <td className="py-2.5 text-gray-400">{a.categoryName}</td>
                  <td className="py-2.5 text-right text-gray-300 font-mono">{fmtL(a.litres)}</td>
                  <td className="py-2.5 text-right text-gray-400">{fmtRs(a.costCents)}</td>
                  <td className="py-2.5 text-right text-gray-400 font-mono">{a.runningDelta > 0 ? `${fmtL(a.runningDelta)} ${a.meterType}` : "—"}</td>
                  <td className="py-2.5 text-right text-gray-400 font-mono">{a.recommended != null ? `${fmtL(a.recommended)} ${a.meterType}` : "—"}</td>
                  <td className="py-2.5 text-right">
                    <span className={`text-[10px] font-bold rounded-lg px-2 py-1 ${FLAG_STYLE[a.flag] ?? "bg-white/5 text-gray-400"}`}>
                      {a.flag === "METER_LOW" ? "METER LOW" : a.flag === "METER_HIGH" ? "METER HIGH" : "OK"}
                    </span>
                  </td>
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
  return <div className="text-center py-8 text-xs text-gray-500">No fuel issues in this month.</div>;
}
