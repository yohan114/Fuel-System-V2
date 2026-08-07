import React from "react";
import Link from "next/link";
import { Database, Warehouse, AlertTriangle } from "lucide-react";

// Stock across every pump, on one screen.
//
// The single-pump console answers "what is in MY tank"; an admin needs "what is
// in ALL of them" — which tanks are dry, which are holding stock, and where the
// day's fuel went. Each card links into that site's fuel issues so the question
// "why is this tank empty" is one click from the number.
//
// A pump is called low at under a tenth of its capacity: that is the point where
// a site needs a delivery ordered rather than noted.
const LOW_FRACTION = 0.1;

export type PumpCard = {
  id: string;
  name: string;
  fuelKind: string;
  capacity: number;
  balance: number;
  projectCode: string | null;
  projectName: string | null;
  issuedToday: number;
  isWorkshop: boolean;
};

function Card({ p }: { p: PumpCard }) {
  const percent = p.capacity > 0
    ? Math.min(100, Math.max(0, (p.balance / p.capacity) * 100))
    : 0;
  const low = p.capacity > 0 && p.balance < p.capacity * LOW_FRACTION;

  // Site users filter the issue log by site code; without one the link would
  // silently show every site's fuel, so fall back to the unfiltered log.
  const href = p.projectCode
    ? `/fuel/issues?site=${encodeURIComponent(p.projectCode)}`
    : "/fuel/issues";

  return (
    <Link
      href={href}
      className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md hover:border-indigo-500/30 transition-colors h-full flex flex-col gap-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`p-2 rounded-xl shrink-0 ${p.isWorkshop ? "bg-emerald-500/10 text-emerald-400" : "bg-indigo-500/10 text-indigo-400"}`}>
            {p.isWorkshop ? <Warehouse size={18} /> : <Database size={18} />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate" title={p.name}>{p.name}</div>
            <div className="text-[10px] tracking-wide text-gray-500 uppercase mt-0.5">
              {p.projectCode ?? "unassigned"} · {p.fuelKind.replace("_", " ")}
            </div>
          </div>
        </div>
        {low && (
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-1.5 py-0.5 shrink-0">
            <AlertTriangle size={11} /> Low
          </span>
        )}
      </div>

      <div className="mt-auto space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold text-white">
            {p.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })} L
          </span>
          <span className="text-[11px] text-gray-500">of {p.capacity.toLocaleString()} L</span>
        </div>

        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${low ? "bg-red-500/70" : "bg-indigo-500"}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <span>{percent.toFixed(0)}% full</span>
          <span>
            {p.issuedToday > 0
              ? `${p.issuedToday.toLocaleString(undefined, { maximumFractionDigits: 1 })} L issued today`
              : "0 L issued today"}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function PumpOverview({ pumps }: { pumps: PumpCard[] }) {
  const workshop = pumps.filter((p) => p.isWorkshop);
  const sites = pumps.filter((p) => !p.isWorkshop);

  const totalStock = pumps.reduce((s, p) => s + p.balance, 0);
  const dry = pumps.filter((p) => p.balance <= 0).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Pump Overview</h1>
        <p className="text-xs text-gray-400 mt-1 max-w-3xl">
          Stock across every pump. Click any tank to see that site&apos;s fuel issues, filter by
          vehicle and date, and download a PDF or Excel report.
        </p>
        <p className="text-[11px] text-gray-500 mt-2">
          {pumps.length} pumps · {totalStock.toLocaleString(undefined, { maximumFractionDigits: 1 })} L in stock
          {dry > 0 && <> · <span className="text-red-300">{dry} empty</span></>}
        </p>
      </div>

      {workshop.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <Warehouse size={14} /> Main workshop pump
            <span className="text-gray-500 font-normal normal-case tracking-normal">
              — may fuel any vehicle on any site
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {workshop.map((p) => <Card key={p.id} p={p} />)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-400">
          <Database size={14} /> Site pumps
          <span className="text-gray-500 font-normal normal-case tracking-normal">
            — restricted to vehicles allocated to their own site
          </span>
        </h2>
        {sites.length === 0 ? (
          <div className="bg-[#121420] border border-white/5 rounded-2xl p-10 text-center text-xs text-gray-500">
            No site pumps yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sites.map((p) => <Card key={p.id} p={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
