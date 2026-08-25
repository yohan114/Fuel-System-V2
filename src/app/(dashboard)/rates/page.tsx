import React from "react";
import Link from "next/link";
import { Gauge, AlertTriangle, TrendingUp, FileSpreadsheet, Info } from "lucide-react";
import { getSession } from "@/lib/auth";
import { billingScope } from "@/lib/roles";
import { getRatesOverview } from "@/lib/consumption/rates-overview";
import { getPortableOverview } from "@/lib/consumption/portable-overview";
import RatesTable from "./RatesTable";
import PortableRates from "./PortableRates";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ rows, counts, litresMeasured, litresTotal }, portable] = await Promise.all([
    getRatesOverview(),
    getPortableOverview(),
  ]);
  const pct = litresTotal > 0 ? (100 * litresMeasured) / litresTotal : 0;
  // Same helper the export route gates on, so the button and the download
  // cannot disagree about who may have it.
  const canExport = billingScope(session).kind === "all";

  // Counted here rather than in the overview because it is a question about
  // pricing, not consumption, and the two are only now on the same page.
  const priced = {
    wet: rows.filter((r) => r.wetCents != null).length,
    dry: rows.filter((r) => r.dryCents != null).length,
    fullyWet: rows.filter((r) => r.fullyWetCents != null).length,
    defaultWet: rows.filter((r) => r.defaultBasis === "w").length,
    defaultDry: rows.filter((r) => r.defaultBasis === "d").length,
    defaultUnset: rows.filter((r) => !r.defaultBasis).length,
    unpriced: rows.filter((r) => r.dryCents == null && r.wetCents == null && r.fullyWetCents == null).length,
  };

  const stat = (label: string, value: string | number, tone = "text-white", note?: string) => (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
      <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">{label}</span>
      <span className={`text-2xl font-bold block mt-1 ${tone}`}>{value}</span>
      {note ? <span className="text-[10px] text-gray-500 block mt-0.5">{note}</span> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Gauge className="w-5 h-5 text-indigo-400" />
            Fuel &amp; Rental Rates
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            What each machine burns and what it is charged, on one screen. Consumption bands come from the 2026
            Fleet Rental Prices workbook; the hire rates are editable here.
          </p>
        </div>
        {/* The export carries the whole fleet's commercial rates, so the route
            serves it to administrators and allocators only. Showing the button
            to anyone else would just hand them a 403. */}
        {canExport ? (
          <a
            href="/api/rates/xlsx"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export to Excel
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat("Over standard", counts.over + counts.heavy, counts.over + counts.heavy > 0 ? "text-rose-400" : "text-emerald-400",
          `${counts.over} above the heavy threshold`)}
        {stat("Measured", counts.verdicts, "text-white", `of ${counts.total} machines`)}
        {stat("With a standard band", counts.withBand, "text-white", `${counts.withHeavy} have a heavy threshold`)}
        {stat("Fuel checked", `${pct.toFixed(1)}%`, pct < 20 ? "text-amber-400" : "text-white",
          `${litresMeasured.toLocaleString()} of ${litresTotal.toLocaleString()} L`)}
      </div>

      {/* Pricing coverage, the counterpart to the consumption tiles above. A
          machine with no wet rate earns nothing however hard it works, and that
          is invisible unless somebody counts it. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat("Priced wet", priced.wet, priced.wet < counts.total ? "text-amber-400" : "text-emerald-400",
          `${counts.total - priced.wet} have no wet rate`)}
        {stat("Priced dry", priced.dry, "text-white", `${priced.fullyWet} carry a fully-wet rate`)}
        {stat("Bills wet by default", priced.defaultWet, "text-white",
          `${priced.defaultDry} default to dry, ${priced.defaultUnset} unset`)}
        {stat("No rate at all", priced.unpriced, priced.unpriced > 0 ? "text-rose-400" : "text-emerald-400",
          "they invoice nothing for their work")}
      </div>

      {/* The honest caveats, stated once, up front. */}
      <div className="bg-[#121420] border border-amber-500/20 rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Read this before acting on a verdict</span>
        </div>
        <ul className="text-[11px] text-gray-400 space-y-1 list-disc list-inside">
          <li>
            The standard bands are <span className="text-gray-300">class estimates, not measurements</span>. The workbook
            sets Typical from the machine&apos;s model size and age, then derives Econ and Heavy from it by a fixed ratio —
            so every dump truck in the fleet shares one band.
          </li>
          <li>
            A verdict needs at least 3 measured intervals. {counts.total - counts.verdicts} machines have no verdict,
            almost all because the meter is never read when fuel is issued.
          </li>
          <li>
            {counts.basisConflict} machines carry an hour-based band while sitting on a km odometer, so their burn
            cannot be compared until the meter type is corrected. They are marked
            <span className="text-gray-300"> not comparable</span> rather than given a misleading verdict.
          </li>
          <li>
            Road vehicles are shown in <span className="text-gray-300">km/L</span> (higher is better), machinery in{" "}
            <span className="text-gray-300">L/hr</span> (lower is better) — matching the workbook.
          </li>
          <li>
            The {portable.counts.total} portable machines are priced <span className="text-gray-300">per day</span>, not
            per hour, off a separate capacity card — they are in their own section below rather than in the table above.
          </li>
        </ul>
      </div>

      {(counts.over > 0 || counts.heavy > 0) && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Burning above standard
          </h2>
          <div className="space-y-2">
            {rows
              .filter((r) => r.state === "OVER" || r.state === "HEAVY")
              .slice(0, 12)
              .map((r) => (
                <Link
                  key={r.assetId}
                  href={`/fleet/${encodeURIComponent(r.code)}`}
                  className="flex items-center justify-between bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 hover:border-indigo-500/40 transition"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white">{r.code}</span>
                    <span className="text-[10px] text-gray-500 ml-2">{r.categoryName ?? "—"}</span>
                    <span className="text-[10px] text-gray-500 block truncate">{r.projectName ?? "unassigned"}</span>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <span className={`text-sm font-bold ${r.state === "OVER" ? "text-rose-400" : "text-amber-400"}`}>
                      {r.actualDisplay?.toFixed(1)} {r.unit}
                    </span>
                    <span className="text-[10px] text-gray-500 block">
                      standard {r.typDisplay?.toFixed(1)} · {r.severity.toFixed(2)}× · {r.intervals} intervals
                    </span>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      )}

      <RatesTable rows={rows} canEdit={session.role === "ADMIN"} />

      {/* Portable plant is priced on its own card, in Rs/day rather than Rs/hr,
          so it gets its own section rather than being squeezed into a table
          whose columns mean something else. */}
      <PortableRates data={portable} canEdit={session.role === "ADMIN"} />

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          Gaps to close
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#1b1e30] rounded-xl p-4">
            <span className="text-2xl font-bold text-white block">{counts.noRateCard}</span>
            <span className="text-gray-400 block mt-1">machines have no rate card at all</span>
            <span className="text-[10px] text-gray-500 block mt-1">
              They invoice neither rental nor fuel, and can never get a band.
            </span>
          </div>
          <div className="bg-[#1b1e30] rounded-xl p-4">
            <span className="text-2xl font-bold text-white block">{counts.basisConflict}</span>
            <span className="text-gray-400 block mt-1">carry an hour band on a km meter</span>
            <span className="text-[10px] text-gray-500 block mt-1">
              The workbook and the fleet register disagree. Fixing the meter type unlocks the check.
            </span>
          </div>
          <div className="bg-[#1b1e30] rounded-xl p-4">
            <span className="text-2xl font-bold text-white block">{counts.total - counts.measured}</span>
            <span className="text-gray-400 block mt-1">have never been measured</span>
            <span className="text-[10px] text-gray-500 block mt-1">
              Recording the meter at every fill is what turns these into a verdict.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
