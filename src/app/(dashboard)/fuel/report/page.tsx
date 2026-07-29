import React from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSiteUser } from "@/lib/roles";
import { fuelKindLabel } from "@/lib/fuel-kinds";
import { buildFuelIssueReport, parseRange, ymd, REPORT_ROW_LIMIT } from "@/lib/fuel/issue-report";
import { FileText, AlertTriangle } from "lucide-react";
import FuelReportFilters from "./FuelReportFilters";

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    site?: string;
    vehicle?: string;
    fuelKind?: string;
  }>;
}

function money(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
}

function litres(n: number) {
  return `${n.toLocaleString("en-LK", { maximumFractionDigits: 1 })} L`;
}

export default async function FuelReportPage(props: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await props.searchParams;
  const { from, to } = parseRange(sp.from, sp.to);
  const siteLocked = isSiteUser(session.role);

  const report = await buildFuelIssueReport(
    {
      from,
      to,
      siteId: sp.site || null,
      vehicle: sp.vehicle || null,
      fuelKind: sp.fuelKind || null,
    },
    { role: session.role, projectId: session.projectId },
  );

  // Filter option sources. A site user only ever sees their own site.
  const [sites, vehicleRows] = await Promise.all([
    prisma.project.findMany({
      where: siteLocked && session.projectId ? { id: session.projectId } : {},
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.asset.findMany({
      where: { status: { not: "DISPOSED" } },
      select: { code: true, regNo: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const vehicles = [...new Set(vehicleRows.flatMap((a) => [a.code, a.regNo].filter(Boolean) as string[]))];

  const params = new URLSearchParams();
  params.set("from", ymd(from));
  params.set("to", ymd(to));
  if (sp.site) params.set("site", sp.site);
  if (sp.vehicle) params.set("vehicle", sp.vehicle);
  if (sp.fuelKind) params.set("fuelKind", sp.fuelKind);
  const exportQuery = `?${params.toString()}`;

  const siteLabel = sp.site ? sites.find((s) => s.id === sp.site)?.name ?? "Selected site" : "All sites";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-400" /> Fuel Issue Report
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Every fuel issue for one vehicle or a whole site over a date range. Fuel is
          attributed to the vehicle&apos;s allocated site on the day it was issued, not to
          the pump it was drawn from.
        </p>
      </div>

      <FuelReportFilters
        sites={sites.map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }))}
        vehicles={vehicles}
        siteLocked={siteLocked}
        current={{
          from: ymd(from),
          to: ymd(to),
          site: siteLocked ? session.projectId ?? "" : sp.site ?? "",
          vehicle: sp.vehicle ?? "",
          fuelKind: sp.fuelKind ?? "",
        }}
        exportQuery={exportQuery}
      />

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Litres", value: litres(report.totals.litres) },
          { label: "Total Cost", value: money(report.totals.costCents) },
          { label: "Fuel Issues", value: report.totals.issueCount.toLocaleString() },
          { label: "Vehicles", value: report.totals.vehicleCount.toLocaleString() },
        ].map((k) => (
          <div key={k.label} className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block">{k.label}</span>
            <span className="text-lg font-bold text-white block mt-1">{k.value}</span>
          </div>
        ))}
      </div>

      {report.truncated && (
        <div className="bg-amber-500/10 border border-amber-500/15 text-amber-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            Showing the first {REPORT_ROW_LIMIT.toLocaleString()} issues only — narrow the
            date range or pick a site for a complete report.
          </span>
        </div>
      )}

      {/* Rows */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-3">
          {siteLabel} · {ymd(from)} to {ymd(to)}
          {sp.vehicle ? ` · ${sp.vehicle.toUpperCase()}` : ""}
        </h3>

        {report.rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">
            No fuel issues match these filters.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Site</th>
                <th className="py-2.5">Fuel</th>
                <th className="py-2.5 text-right">Litres</th>
                <th className="py-2.5 text-right">Cost</th>
                <th className="py-2.5 text-right">Meter</th>
                <th className="py-2.5">Issued by</th>
                <th className="py-2.5">Pump</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {report.rows.map((r) => (
                <tr key={r.id} className={`hover:bg-white/[0.01] ${r.voided ? "opacity-40 line-through" : ""}`}>
                  <td className="py-3 text-gray-400 whitespace-nowrap">
                    {new Date(r.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                  </td>
                  <td className="py-3 font-bold text-white">
                    {r.assetCode}
                    {r.assetRegNo && <span className="text-gray-500 font-normal"> · {r.assetRegNo}</span>}
                  </td>
                  <td className="py-3 text-gray-400">{r.siteCode ?? "—"}</td>
                  <td className="py-3 text-gray-400">{fuelKindLabel(r.fuelKind)}</td>
                  <td className="py-3 text-right text-white font-semibold">{r.litres.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-300">{money(r.totalCostCents)}</td>
                  <td className="py-3 text-right text-gray-400 font-mono">
                    {r.meterReading !== null ? `${r.meterReading.toLocaleString()} ${r.readingType ?? ""}` : "—"}
                  </td>
                  <td className="py-3 text-gray-400">{r.issuedByName}</td>
                  <td className="py-3 text-gray-500">{r.source}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-bold text-white">
                <td className="py-3" colSpan={4}>
                  Total ({report.totals.issueCount} issues)
                </td>
                <td className="py-3 text-right">{report.totals.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                <td className="py-3 text-right">{money(report.totals.costCents)}</td>
                <td className="py-3" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
