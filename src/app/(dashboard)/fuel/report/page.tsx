import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fuelViewScope } from "@/lib/fuel/view-scope";
import { FUEL_KINDS } from "@/lib/fuel-kinds";
import { buildFuelIssueReport, parseReportParams, reportFilterForScope, type ReportSiteBasis } from "@/lib/reports/fuel-issue-report";
import { fuelDate } from "@/lib/colombo-date";
import { FileText, FileSpreadsheet, Filter, Search } from "lucide-react";

// One vehicle or one site, over a date range, issue by issue.
//
// /reports answers "what did the fleet cost this month" in aggregate. This
// answers the question people actually bring to the office: "show me every drop
// this machine took in July", or "prove this site's 9,285 litres". It is the
// page that gets printed and handed to a client, so it carries the same figures
// to PDF and Excel rather than making anyone re-key them.

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; site?: string; vehicle?: string; fuelKind?: string; basis?: string }>;
}

const rs = (cents: number) => "Rs. " + Math.round(cents / 100).toLocaleString("en-LK");

export default async function FuelIssueReportPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const sp = await props.searchParams;
  const p = parseReportParams((k) => (sp as Record<string, string | undefined>)[k]);

  // The same scope the fuel issues log uses, so the two screens cannot disagree
  // about what a login may read. A pump operator reports on their own pump's
  // book; a site login on the fuel its site is charged for; anything the scope
  // cannot resolve reports on nothing. Whatever the query string says.
  const scope = await fuelViewScope(session);
  // Which question a site filter asks. Only a reader entitled to every site has
  // the choice; the other scopes are already one answer or the other.
  const basis: ReportSiteBasis = sp.basis === "pump" ? "pump" : "allocation";
  const scoped = reportFilterForScope(scope, p.site, basis);
  const scopeSiteId = scoped.projectId ?? scoped.pumpProjectId;
  const locked = scope.kind !== "all";

  const [projects, report] = await Promise.all([
    prisma.project.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    buildFuelIssueReport({ from: p.from, to: p.to, vehicle: p.vehicle, fuelKind: p.fuelKind, ...scoped }),
  ]);
  const siteName = scopeSiteId
    ? projects.find((x) => x.id === scopeSiteId)?.name ?? "Site"
    : scope.kind === "none"
      ? "No site assigned"
      : "All sites";

  // The downloads carry exactly what is on screen. The site is passed for a
  // reader who chose it; a scoped reader's own site is re-derived server-side, so
  // editing it out of the link changes nothing.
  const qs = new URLSearchParams({
    from: p.fromStr, to: p.toStr,
    ...(scoped.projectId ? { site: scoped.projectId } : {}),
    ...(scoped.pumpProjectId && scope.kind === "all" ? { site: scoped.pumpProjectId, basis: "pump" } : {}),
    ...(p.vehicle ? { vehicle: p.vehicle } : {}),
    ...(p.fuelKind ? { fuelKind: p.fuelKind } : {}),
  }).toString();

  const field = "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50";
  const label = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <FileText size={22} className="text-indigo-400" /> Fuel Issue Report
        </h1>
        <p className="text-xs text-gray-400 mt-1 max-w-4xl">
          {scoped.pumpProjectId ? (
            <>Every issue dispensed from the {siteName} pump — including machines visiting from other
            sites, and excluding {siteName} machines that fuelled elsewhere. The Site column shows whose
            fuel it is: the vehicle&apos;s allocated site on the day, which is the site charged for it.</>
          ) : (
            <>Every fuel issue for one vehicle or a whole site over a date range. Fuel is attributed to the
            vehicle&apos;s allocated site on the day it was issued, not to the pump it was drawn from.
            {!locked && <> To count a site by its own pump instead, change &ldquo;Count that site by&rdquo; below.</>}</>
          )}
        </p>
      </div>

      <form method="GET" className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={label}>From</label>
            <input type="date" name="from" defaultValue={p.fromStr} className={field} />
          </div>
          <div>
            <label className={label}>To</label>
            <input type="date" name="to" defaultValue={p.toStr} className={field} />
          </div>
          <div>
            <label className={label}>Site</label>
            <select name="site" defaultValue={scopeSiteId ?? p.site} className={field} disabled={locked}>
              <option value="">{locked ? "—" : "All sites"}</option>
              {projects.map((x) => (
                <option key={x.id} value={x.id}>{x.name} ({x.code})</option>
              ))}
            </select>
          </div>
          {/* Which question the Site box asks. Only offered to a reader entitled
              to every site — a pump operator and a site login are each already
              one answer, and letting them switch would widen what they can see. */}
          {!locked && (
            <div>
              <label className={label}>Count that site by</label>
              <select name="basis" defaultValue={basis} className={field}>
                <option value="allocation">Vehicle&apos;s allocated site — what it is billed</option>
                <option value="pump">The site&apos;s own pump — what left its tank</option>
              </select>
            </div>
          )}
          <div>
            <label className={label}>Vehicle</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" name="vehicle" defaultValue={p.vehicle} placeholder="Code or reg no…"
                className={`${field} pl-8`} />
            </div>
          </div>
          <div>
            <label className={label}>Fuel</label>
            <select name="fuelKind" defaultValue={p.fuelKind} className={field}>
              <option value="">All fuels</option>
              {FUEL_KINDS.map((k) => <option key={k.code} value={k.code}>{k.short}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl active:scale-95 transition-all shadow-md">
            <Filter size={14} /> Apply Filters
          </button>
          <a href={`/api/fuel/report/pdf?${qs}`}
            className="flex items-center gap-2 bg-[#1b1e30] border border-white/5 hover:border-red-500/30 text-gray-300 hover:text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all">
            <FileText size={14} className="text-red-400" /> Download PDF
          </a>
          <a href={`/api/fuel/report/xlsx?${qs}`}
            className="flex items-center gap-2 bg-[#1b1e30] border border-white/5 hover:border-emerald-500/30 text-gray-300 hover:text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all">
            <FileSpreadsheet size={14} className="text-emerald-400" /> Download Excel
          </a>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total litres", value: `${report.totals.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })} L` },
          { label: "Total cost", value: rs(report.totals.costCents) },
          { label: "Fuel issues", value: report.totals.issues.toLocaleString() },
          { label: "Vehicles", value: report.totals.vehicles.toLocaleString() },
        ].map((c) => (
          <div key={c.label} className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{c.label}</div>
            <div className="text-2xl font-bold text-white mt-2">{c.value}</div>
          </div>
        ))}
      </div>

      {report.perSite.length > 1 && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">By site</h2>
          <div className="flex flex-wrap gap-2">
            {report.perSite.map((s) => (
              <span key={s.code} className="text-[11px] bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-1.5 text-gray-300">
                <span className="text-white font-semibold">{s.code}</span>{" "}
                {s.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })} L · {rs(s.costCents)} · {s.issues} issues
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#121420] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-300">
            {siteName} · {p.fromStr} to {p.toStr}
          </h2>
          {report.truncated && (
            <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1">
              showing the first 5,000 rows — narrow the range for the rest
            </span>
          )}
        </div>

        {report.rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            No fuel was issued matching these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d0f1a] text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Vehicle</th>
                  <th className="px-4 py-3 font-semibold">Site</th>
                  <th className="px-4 py-3 font-semibold">Fuel</th>
                  <th className="px-4 py-3 font-semibold text-right">Litres</th>
                  <th className="px-4 py-3 font-semibold text-right">Cost</th>
                  <th className="px-4 py-3 font-semibold text-right">Meter</th>
                  <th className="px-4 py-3 font-semibold">Issued by</th>
                  <th className="px-6 py-3 font-semibold">Pump</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {report.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3 text-gray-300 whitespace-nowrap">{fuelDate(r.day + "T00:00:00+05:30")}</td>
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold">{r.assetCode}</span>
                      {r.assetRegNo && <span className="text-gray-500"> · {r.assetRegNo}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.siteCode ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{r.fuelKind.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-right text-white font-semibold">{r.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{rs(r.costCents)}</td>
                    <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap font-mono">
                      {r.meterReading != null ? `${r.meterReading.toLocaleString()} ${r.readingType ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.issuedBy}</td>
                    <td className="px-6 py-3 text-gray-500">{r.pumpName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
