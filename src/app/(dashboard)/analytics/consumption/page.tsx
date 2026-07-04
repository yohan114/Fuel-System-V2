import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getFleetConsumptionHealth, type ConsumptionRow, type ConsumptionState } from "@/lib/analytics/consumption";
import { currentMonthPeriod } from "@/lib/billing/period";
import { Activity, Droplets, Flame, Gauge, Wrench } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; site?: string }>;
}

const STATE_META: Record<ConsumptionState, { label: string; dot: string; text: string }> = {
  OVER: { label: "Over heavy — repair candidate", dot: "bg-rose-400", text: "text-rose-400" },
  HEAVY: { label: "Heavy burn — watch", dot: "bg-amber-400", text: "text-amber-400" },
  NORMAL: { label: "Normal (econ–typ)", dot: "bg-emerald-400", text: "text-emerald-400" },
  BELOW_ECON: { label: "Below econ — check reporting", dot: "bg-sky-400", text: "text-sky-400" },
  NO_METER: { label: "Fuel but no meter movement", dot: "bg-gray-500", text: "text-gray-400" },
  NO_BAND: { label: "No band on rate card", dot: "bg-gray-600", text: "text-gray-500" },
};

function fmt(n: number | null, frac = 1) {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: frac });
}

export default async function ConsumptionPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isSiteUser = session.role === "USER" && !!session.projectId;
  const sp = await props.searchParams;
  const cur = currentMonthPeriod();
  const fromStr = sp.from || cur.start.toISOString().split("T")[0];
  const toStr = sp.to || cur.end.toISOString().split("T")[0];
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);

  const projects = isSiteUser ? [] : await prisma.project.findMany({ orderBy: { name: "asc" } });
  const siteFilter = isSiteUser ? session.projectId! : sp.site && projects.some((p) => p.id === sp.site) ? sp.site : undefined;

  const { rows, counts } = await getFleetConsumptionHealth({ from, to, projectId: siteFilter });
  const charted = rows.filter((r) => r.actualRate != null && (r.econ != null || r.typ != null || r.heavy != null));
  const noMeter = rows.filter((r) => r.state === "NO_METER");

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-400" /> Fuel Consumption Health
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Actual burn (issued litres ÷ running-chart meter) placed on each vehicle&apos;s econ / typ / heavy band from the 2026 rate sheet.
            Above the heavy bound points at repairs; below econ points at reporting.{" "}
            <Link href="/analytics" className="text-indigo-400 hover:underline">Utilization &amp; downtime →</Link>
          </p>
        </div>
        <form method="GET" action="/analytics/consumption" className="flex items-end gap-2">
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

      {/* State tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi label="Repair candidates" value={counts.OVER} className="text-rose-400" icon={<Wrench className="w-5 h-5" />} />
        <Kpi label="Heavy burn" value={counts.HEAVY} className="text-amber-400" icon={<Flame className="w-5 h-5" />} />
        <Kpi label="Normal" value={counts.NORMAL} className="text-emerald-400" icon={<Activity className="w-5 h-5" />} />
        <Kpi label="Below econ" value={counts.BELOW_ECON} className="text-sky-400" icon={<Droplets className="w-5 h-5" />} />
        <Kpi label="No meter" value={counts.NO_METER} className="text-gray-400" icon={<Gauge className="w-5 h-5" />} />
        <Kpi label="No band" value={counts.NO_BAND} className="text-gray-500" icon={<Gauge className="w-5 h-5" />} />
      </div>

      {/* Band chart */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 border-b border-white/5 pb-2 flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" /> Actual burn on the econ–typ–heavy band (worst first)
        </h3>
        <div className="flex flex-wrap gap-4 py-2 text-[10px] text-gray-500">
          <span><span className="inline-block w-3 h-2 rounded-sm bg-emerald-500/20 mr-1 align-middle" />econ → typ</span>
          <span><span className="inline-block w-3 h-2 rounded-sm bg-amber-500/20 mr-1 align-middle" />typ → heavy</span>
          <span><span className="inline-block w-3 h-2 rounded-sm bg-rose-500/15 mr-1 align-middle" />past heavy</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-white mr-1 align-middle" />actual (colored by state)</span>
        </div>
        {charted.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No vehicles with fuel, meter movement and a consumption band in this period.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {charted.slice(0, 80).map((r) => (
              <BandRow key={r.assetId} r={r} />
            ))}
          </div>
        )}
      </div>

      {/* Fuel without meter movement */}
      {noMeter.length > 0 && (
        <details className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
          <summary className="cursor-pointer px-5 py-4 text-xs font-semibold text-gray-300 hover:text-white flex items-center gap-2">
            <Gauge className="w-4 h-4 text-gray-500" /> {noMeter.length} vehicle{noMeter.length === 1 ? "" : "s"} drew fuel with no meter movement — cannot compute a rate (also flagged on Fuel Integrity)
          </summary>
          <div className="px-5 pb-4 flex flex-wrap gap-1.5">
            {noMeter.slice(0, 60).map((r) => (
              <Link key={r.assetId} href={`/fleet/${r.code}`} className="text-[10px] font-mono bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg px-2 py-1">
                {r.code} · {fmt(r.litres, 0)} L
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function BandRow({ r }: { r: ConsumptionRow }) {
  const meta = STATE_META[r.state];
  const scaleMax = Math.max(r.heavy ?? 0, r.typ ?? 0, r.actualRate ?? 0) * 1.12 || 1;
  const pct = (v: number) => Math.min((v / scaleMax) * 100, 100);
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="w-40 shrink-0">
        <Link href={`/fleet/${r.code}`} className="font-bold text-white hover:text-indigo-400 text-xs">{r.code}</Link>
        <span className="block text-[10px] text-gray-500 truncate">{r.categoryName}{r.projectName ? ` · ${r.projectName}` : ""}</span>
      </div>
      <div className="flex-1 min-w-[260px]">
        <div className="relative h-2.5 rounded-full bg-white/5" title={`actual ${fmt(r.actualRate, 2)} L/${r.unit} — band ${fmt(r.econ)} / ${fmt(r.typ)} / ${fmt(r.heavy)} L/${r.unit}`}>
          {r.econ != null && r.typ != null && (
            <div className="absolute h-full bg-emerald-500/20 rounded-l-full" style={{ left: `${pct(r.econ)}%`, width: `${Math.max(pct(r.typ) - pct(r.econ), 0)}%` }} />
          )}
          {r.typ != null && r.heavy != null && (
            <div className="absolute h-full bg-amber-500/20" style={{ left: `${pct(r.typ)}%`, width: `${Math.max(pct(r.heavy) - pct(r.typ), 0)}%` }} />
          )}
          {r.heavy != null && (
            <div className="absolute h-full bg-rose-500/15 rounded-r-full" style={{ left: `${pct(r.heavy)}%`, width: `${Math.max(100 - pct(r.heavy), 0)}%` }} />
          )}
          {r.actualRate != null && (
            <span className={`absolute w-3 h-3 rounded-full border-2 border-[#121420] -top-[1px] ${meta.dot}`} style={{ left: `calc(${pct(r.actualRate)}% - 6px)` }} />
          )}
        </div>
      </div>
      <div className="w-56 shrink-0 text-right">
        <span className={`text-xs font-bold ${meta.text}`}>{fmt(r.actualRate, 2)} L/{r.unit}</span>
        <span className="text-[10px] text-gray-500"> · band {fmt(r.econ)} / {fmt(r.typ)} / {fmt(r.heavy)}</span>
        <span className="block text-[10px] text-gray-600">{fmt(r.litres, 0)} L over {fmt(r.meterDelta, 0)} {r.unit} — {meta.label}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, className, icon }: { label: string; value: number; className: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 shadow-md">
      <div className={`flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider`}>{icon}{label}</div>
      <div className={`text-lg font-bold mt-1 ${className}`}>{value}</div>
    </div>
  );
}
