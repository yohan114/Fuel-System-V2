import React from "react";
import Link from "next/link";
import { FileSpreadsheet, ArrowLeft, CheckCircle2, AlertTriangle, MapPin, Fuel } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isSiteUser } from "@/lib/roles";
import { currentMonthPeriod } from "@/lib/billing/period";
import { buildMonthlySiteFuel, UNASSIGNED_ID } from "@/lib/reports/monthly-site-fuel";

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

const rs = (cents: number) => "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
const L = (n: number) => n.toLocaleString("en-LK", { maximumFractionDigits: 2 });

export default async function SiteFuelReportPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const sp = await props.searchParams;
  const now = new Date();
  const fallback = currentMonthPeriod(now);
  const year = Number(sp.year) || fallback.year;
  const month = Number(sp.month) || fallback.month;

  // A site user only ever sees their own site.
  const projectId = isSiteUser(session.role) ? session.projectId ?? undefined : undefined;
  const report = await buildMonthlySiteFuel({ year, month, projectId });
  const { totals, byRule, reconciliation } = report;

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const years = Array.from({ length: 4 }, (_, i) => fallback.year - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <Link href="/reports" className="text-[11px] text-gray-500 hover:text-gray-300 flex items-center gap-1.5 mb-1">
            <ArrowLeft className="w-3 h-3" /> Reports &amp; Exports
          </Link>
          <h1 className="text-xl font-bold text-white tracking-wide">Monthly Fuel Issue Summary — Site Wise</h1>
          <p className="text-xs text-gray-400 mt-1">
            Every fuel issue in the month attributed to one site, by where the machine was posted on the day it fuelled.
          </p>
        </div>
        <a
          href={`/api/reports/site-fuel/xlsx?year=${year}&month=${month}`}
          className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-emerald-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all h-fit"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          Download Sheet
        </a>
      </div>

      <form method="GET" action="/reports/site-fuel" className="bg-[#121420] border border-white/5 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Month</label>
          <select name="month" defaultValue={month} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50">
            {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Year</label>
          <select name="year" defaultValue={year} className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all">
            Show {report.period.label}
          </button>
        </div>
      </form>

      {/* Reconciliation — the point of the sheet is that these always agree. */}
      <div className={`rounded-2xl p-4 border flex flex-wrap items-center gap-x-6 gap-y-2 text-xs ${
        reconciliation.balanced
          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
          : "bg-red-500/10 border-red-500/25 text-red-200"}`}>
        {reconciliation.balanced
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
        <span className="font-semibold">
          {reconciliation.balanced
            ? `All ${reconciliation.issuesInMonth.toLocaleString()} fuel issues assigned — site totals match the month exactly.`
            : `Mismatch: ${reconciliation.issuesOnSheet} of ${reconciliation.issuesInMonth} issues on the sheet.`}
        </span>
        <span className="text-gray-400">
          by posting <strong className="text-gray-200">{byRule.posted.toLocaleString()}</strong>
          {" · "}by tank <strong className="text-gray-200">{byRule.tank.toLocaleString()}</strong>
          {byRule.current > 0 && <> · by current site <strong className="text-gray-200">{byRule.current}</strong></>}
          {byRule.unassigned > 0 && <> · <strong className="text-red-300">unassigned {byRule.unassigned}</strong></>}
          {report.voidedExcluded > 0 && <> · {report.voidedExcluded} voided excluded</>}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Issued", value: `${L(totals.litres)} L`, icon: <Fuel className="w-4 h-4 text-indigo-400" /> },
          { label: "Total Cost", value: rs(totals.costCents), icon: <Fuel className="w-4 h-4 text-emerald-400" /> },
          { label: "Sites", value: String(report.sites.length), icon: <MapPin className="w-4 h-4 text-amber-400" /> },
          { label: "Machines Fuelled", value: String(totals.machineCount), icon: <MapPin className="w-4 h-4 text-sky-400" /> },
        ].map((c) => (
          <div key={c.label} className="bg-[#121420] border border-white/5 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.icon}{c.label}</div>
            <div className="text-lg font-bold text-white mt-2">{c.value}</div>
          </div>
        ))}
      </div>

      {report.sites.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-10 text-center text-xs text-gray-400">
          No fuel issues recorded in {report.period.label}.
        </div>
      ) : (
        <div className="space-y-3">
          {report.sites.map((s) => (
            <details key={s.projectId} className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="cursor-pointer list-none px-5 py-4 hover:bg-white/[0.02] flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className={`font-mono text-[11px] font-bold px-2 py-1 rounded-lg shrink-0 ${
                  s.projectId === UNASSIGNED_ID
                    ? "bg-red-500/10 text-red-300 border border-red-500/20"
                    : "bg-indigo-500/10 text-indigo-300 border border-indigo-500/10"}`}>{s.code}</span>
                <span className="text-white font-semibold text-sm flex-1 min-w-[8rem]">{s.name}</span>
                <span className="text-xs text-gray-400">{s.machineCount} machines</span>
                <span className="text-xs text-gray-400">{s.issueCount.toLocaleString()} issues</span>
                <span className="text-sm font-bold text-white w-28 text-right">{L(s.litres)} L</span>
                <span className="text-xs text-emerald-300 w-32 text-right">{rs(s.costCents)}</span>
                <span className="text-[10px] text-gray-500 w-24 text-right">
                  {s.byRule.tank > 0 ? `${s.byRule.posted} posted / ${s.byRule.tank} tank` : "all posted"}
                </span>
              </summary>
              <div className="border-t border-white/5 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-white/5 text-gray-400 font-semibold">
                      <th className="px-5 py-2.5">Machine</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5 text-right">Issues</th>
                      <th className="px-4 py-2.5 text-right">Litres</th>
                      <th className="px-4 py-2.5 text-right">Cost</th>
                      <th className="px-5 py-2.5 text-right">Assigned by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {s.machines.map((m) => (
                      <tr key={m.assetId} className="hover:bg-white/[0.02]">
                        <td className="px-5 py-2.5">
                          <Link href={`/fleet/${encodeURIComponent(m.code)}`} className="text-indigo-300 hover:text-indigo-200 font-mono font-semibold">{m.code}</Link>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 truncate max-w-[16rem]">{m.label}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{m.issueCount}</td>
                        <td className="px-4 py-2.5 text-right text-white font-semibold">{L(m.litres)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-300">{rs(m.costCents)}</td>
                        <td className="px-5 py-2.5 text-right text-gray-500">
                          {m.postedIssues === m.issueCount ? "posting" : `${m.postedIssues} posting / ${m.issueCount - m.postedIssues} tank`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}

          <div className="bg-[#1b1e30] border border-white/10 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex-1">Month Total</span>
            <span className="text-xs text-gray-400">{totals.machineCount} machines</span>
            <span className="text-xs text-gray-400">{totals.issueCount.toLocaleString()} issues</span>
            <span className="text-sm font-bold text-white w-28 text-right">{L(totals.litres)} L</span>
            <span className="text-xs text-emerald-300 w-32 text-right">{rs(totals.costCents)}</span>
            <span className="w-24" />
          </div>
        </div>
      )}
    </div>
  );
}
