import React from "react";
import Link from "next/link";
import { FileSpreadsheet, ArrowLeft, CheckCircle2, AlertTriangle, MapPin, Fuel, ChevronRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isSiteUser } from "@/lib/roles";
import { currentMonthPeriod } from "@/lib/billing/period";
import { buildMonthlySiteFuel, UNASSIGNED_ID, type ReportBasis } from "@/lib/reports/monthly-site-fuel";

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string; basis?: string }>;
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
  // Default to the pump: this sheet is read by sites, and a site counts what
  // left its own tank. "billed" is the invoicing view and stays one click away.
  const basis: ReportBasis = sp.basis === "billed" ? "billed" : "pump";
  const report = await buildMonthlySiteFuel({ year, month, projectId, basis });
  const { totals, byRule, reconciliation } = report;
  const byPump = basis === "pump";

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
            {byPump
              ? "Every fuel issue grouped under the site whose pump it came out of, whatever site the machine is allocated to."
              : "Every fuel issue attributed to the site that pays for it, by where the machine was posted on the day it fuelled."}
          </p>
        </div>
        <a
          href={`/api/reports/site-fuel/xlsx?year=${year}&month=${month}&basis=${basis}`}
          className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-emerald-500/20 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all h-fit"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          Download Sheet
        </a>
      </div>

      {/* Plain links, not a form control: the basis belongs in the URL so a
          view can be bookmarked and sent to somebody, and so the sheet's
          download link carries the same choice. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1">Count fuel by</span>
        {([
          { key: "pump", label: "The pump it came from", hint: "what left each site's tank" },
          { key: "billed", label: "The site billed for it", hint: "what each site pays for" },
        ] as const).map((opt) => (
          <Link
            key={opt.key}
            href={`/reports/site-fuel?year=${year}&month=${month}&basis=${opt.key}`}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              basis === opt.key
                ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-200"
                : "bg-[#121420] border-white/5 text-gray-400 hover:text-gray-200 hover:border-white/10"}`}
          >
            {opt.label}
            <span className="block text-[9px] font-normal text-gray-500 mt-0.5">{opt.hint}</span>
          </Link>
        ))}
      </div>

      <form method="GET" action="/reports/site-fuel" className="bg-[#121420] border border-white/5 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <input type="hidden" name="basis" value={basis} />
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
                {/* Two different questions, both asked constantly. "Billed" is
                    what this sheet attributes to the site and what adds up to
                    the month. "From its pump" is what the site's own tank
                    register and monthly consumption report count. They differ
                    whenever a machine fuels away from where it is posted. */}
                {/* The active basis in white, its counterpart beside it in grey.
                    Whichever way the sheet is read, the other answer is one
                    glance away instead of one support question away. */}
                <span className="w-28 text-right">
                  <span className="block text-sm font-bold text-white">{L(s.litres)} L</span>
                  <span className="block text-[9px] text-indigo-300/70 uppercase tracking-wider">
                    {byPump ? "from its pump" : "billed"}
                  </span>
                </span>
                <span className="w-28 text-right">
                  <span className={`block text-sm font-semibold ${
                    (byPump ? s.billedLitres : s.pumpLitres) === s.litres ? "text-gray-600" : "text-sky-300/80"}`}>
                    {byPump
                      ? `${L(s.billedLitres)} L`
                      : s.pumpIssueCount === 0 ? "no tank" : `${L(s.pumpLitres)} L`}
                  </span>
                  <span className="block text-[9px] text-gray-600 uppercase tracking-wider">
                    {byPump ? "billed" : "from its pump"}
                  </span>
                </span>
                <span className="text-xs text-emerald-300 w-32 text-right">{rs(s.costCents)}</span>
                <span className="text-[10px] text-gray-500 w-24 text-right">
                  {s.byRule.tank > 0 ? `${s.byRule.posted} posted / ${s.byRule.tank} tank` : "all posted"}
                </span>
              </summary>
              {/* One <details> per machine rather than a table row, so opening a
                  vehicle needs no client JavaScript and the page stays a server
                  component. The header row below keeps the columns readable. */}
              <div className="border-t border-white/5">
                <div className="bg-white/5 text-gray-400 font-semibold text-xs flex items-center gap-x-4 px-5 py-2.5">
                  <span className="flex-1 min-w-[10rem]">Machine</span>
                  <span className="hidden md:block flex-1 min-w-[8rem]">Description</span>
                  <span className="w-16 text-right">Issues</span>
                  <span className="w-24 text-right">Litres</span>
                  <span className="w-28 text-right">Cost</span>
                  <span className="w-32 text-right hidden lg:block">Assigned by</span>
                </div>
                <div className="divide-y divide-white/5">
                  {s.machines.map((m) => (
                    <details key={m.assetId} className="group/machine">
                      <summary className="cursor-pointer list-none flex items-center gap-x-4 px-5 py-2.5 text-xs hover:bg-white/[0.02]">
                        <span className="flex-1 min-w-[10rem] flex flex-wrap items-baseline gap-x-2">
                          <ChevronRight className="w-3 h-3 text-gray-600 shrink-0 transition-transform group-open/machine:rotate-90" />
                          {/* Both numbers, always. The yard says "HEX-37", the
                              paperwork says the plate, and neither alone
                              identifies a machine here — ten registrations in
                              this fleet are shared by two or three assets. */}
                          <span className="font-mono font-semibold text-indigo-300">{m.code}</span>
                          {m.regNo && m.regNo !== m.code && (
                            <span className="font-mono text-[10px] text-gray-500">{m.regNo}</span>
                          )}
                        </span>
                        <span className="hidden md:block flex-1 min-w-[8rem] text-gray-400 truncate">{m.label}</span>
                        <span className="w-16 text-right text-gray-300">{m.issueCount}</span>
                        <span className="w-24 text-right text-white font-semibold">{L(m.litres)}</span>
                        <span className="w-28 text-right text-emerald-300">{rs(m.costCents)}</span>
                        <span className="w-32 text-right text-gray-500 hidden lg:block">
                          {m.postedIssues === m.issueCount ? "posting" : `${m.postedIssues} posting / ${m.issueCount - m.postedIssues} tank`}
                        </span>
                      </summary>

                      <div className="bg-[#0d0f1a] border-t border-white/5 px-5 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                            {m.issueCount} fuel {m.issueCount === 1 ? "issue" : "issues"} in {report.period.label}
                          </span>
                          <Link href={`/fleet/${encodeURIComponent(m.code)}`} className="text-[10px] text-indigo-400 hover:text-indigo-300">
                            Machine history →
                          </Link>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="py-1.5 pr-4 font-semibold">Date</th>
                                <th className="py-1.5 pr-4 font-semibold">Pump</th>
                                <th className="py-1.5 pr-4 font-semibold text-right">Litres</th>
                                <th className="py-1.5 pr-4 font-semibold text-right">Rate</th>
                                <th className="py-1.5 pr-4 font-semibold text-right">Cost</th>
                                <th className="py-1.5 pr-4 font-semibold text-right">Meter</th>
                                <th className="py-1.5 font-semibold">Issued to</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {m.issues.map((i) => (
                                <tr key={i.id} className="text-gray-300">
                                  <td className="py-1.5 pr-4 font-mono whitespace-nowrap">{i.day}</td>
                                  <td className="py-1.5 pr-4">
                                    {/* A machine posted to one site often fuels at
                                        another. Flagging it explains a row that
                                        would otherwise look misfiled. */}
                                    <span className="font-mono text-gray-400">{i.tankSite ?? "—"}</span>
                                    {i.tankSite && i.tankSite !== s.code && (
                                      <span className="ml-1.5 text-[9px] text-amber-400/80">visiting</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-4 text-right text-white font-semibold">{L(i.litres)}</td>
                                  <td className="py-1.5 pr-4 text-right text-gray-500">{(i.pricePerLitre / 100).toFixed(2)}</td>
                                  <td className="py-1.5 pr-4 text-right text-emerald-300/80">{rs(i.costCents)}</td>
                                  <td className="py-1.5 pr-4 text-right font-mono text-gray-500">
                                    {i.meterReading === null ? "—" : `${i.meterReading.toLocaleString()}${i.readingType === "HOURS" ? " h" : i.readingType === "KM" ? " km" : ""}`}
                                  </td>
                                  <td className="py-1.5 text-gray-500 truncate max-w-[12rem]">{i.issuePerson || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-white/10 text-gray-400 font-semibold">
                                <td className="py-1.5 pr-4" colSpan={2}>Total</td>
                                <td className="py-1.5 pr-4 text-right text-white">{L(m.litres)}</td>
                                <td className="py-1.5 pr-4" />
                                <td className="py-1.5 pr-4 text-right text-emerald-300">{rs(m.costCents)}</td>
                                <td className="py-1.5 pr-4" colSpan={2} />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </details>
          ))}

          <div className="bg-[#1b1e30] border border-white/10 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex-1">Month Total</span>
            <span className="text-xs text-gray-400">{totals.machineCount} machines</span>
            <span className="text-xs text-gray-400">{totals.issueCount.toLocaleString()} issues</span>
            <span className="w-28 text-right">
              <span className="block text-sm font-bold text-white">{L(totals.litres)} L</span>
              <span className="block text-[9px] text-indigo-300/70 uppercase tracking-wider">
                {byPump ? "from pumps" : "billed"}
              </span>
            </span>
            <span className="w-28 text-right" />
            <span className="text-xs text-emerald-300 w-32 text-right">{rs(totals.costCents)}</span>
            <span className="w-24" />
          </div>

          {/* The two columns will not agree, and someone will read that as a
              fault unless it is said plainly on the page. */}
          <p className="text-[11px] text-gray-500 px-5 leading-relaxed">
            {byPump ? (
              <>
                Showing <strong className="text-gray-300">what came out of each site&apos;s pump</strong> — every fuel issue counted against the
                tank that served it, whatever site the machine is allocated to. A visiting machine&apos;s fill counts here, at the pump that
                gave it. Sites with no tank of their own do not appear.{" "}
                <strong className="text-gray-400">Billed</strong> beside it is what the same site would be charged, which is the figure an
                invoice uses: Galagedara&apos;s two read 21,640 L and 21,050 L for August, the difference being 840 L out to visitors and 250 L
                back from its own machines fuelling away.
              </>
            ) : (
              <>
                Showing <strong className="text-gray-300">what each site is billed</strong> — every issue of the month attributed to exactly
                one site by where the machine was posted on the day, so these add up to {L(totals.litres)} L.{" "}
                <strong className="text-gray-400">From its pump</strong> beside it is what physically left that site&apos;s tank, which is what the
                storekeeper&apos;s register counts. They differ whenever a machine fuels away from where it is posted.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
