import React from "react";
import Link from "next/link";
import { getBillingReadiness, type ReadinessAsset } from "@/lib/billing/readiness";
import { ClipboardCheck, CheckCircle2, Coins, Gauge, GitMerge, Fuel } from "lucide-react";

// Pre-generation readiness panel: what to fix before generating the month.
export default async function ReadinessReport({ year, month }: { year: number; month: number }) {
  const r = await getBillingReadiness(year, month);
  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const totalIssues =
    r.issues.noRate.length + r.issues.noReading.length + r.issues.overlaps.length + r.issues.unpricedFuel.length;

  return (
    <div className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-indigo-400" /> Billing readiness — {monthLabel}
        </h3>
        <span className={`text-xs font-bold ${totalIssues === 0 ? "text-emerald-400" : "text-amber-400"}`}>
          {r.ready}/{r.availableFleet} ready
        </span>
      </div>

      {r.availableFleet === 0 ? (
        <p className="text-xs text-gray-500">No vehicles have activity or an assignment in {monthLabel} yet.</p>
      ) : totalIssues === 0 ? (
        <p className="text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> All {r.availableFleet} vehicles are ready to bill — rate cards, readings, postings and fuel prices all present.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-gray-400">
            {totalIssues} vehicle{totalIssues !== 1 ? "s" : ""} need attention before this month bills cleanly. Fix these, then generate.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IssueCard
              title="No rate card"
              hint="Cannot be billed — add a rate card."
              icon={<Coins className="w-4 h-4 text-orange-400" />}
              rows={r.issues.noRate}
              tone="text-orange-400"
            />
            <IssueCard
              title="No meter reading"
              hint="Will bill on the minimum or fuel-derived units."
              icon={<Gauge className="w-4 h-4 text-amber-400" />}
              rows={r.issues.noReading}
              tone="text-amber-400"
              href="/readings"
            />
            <IssueCard
              title="Overlapping postings"
              hint="Multi-site split double-counts days — fix on Assignments."
              icon={<GitMerge className="w-4 h-4 text-rose-400" />}
              rows={r.issues.overlaps}
              tone="text-rose-400"
              href="/admin/assignments"
            />
            <IssueCard
              title="Unpriced fuel"
              hint="Fuel line lands at Rs 0 — set the fuel price."
              icon={<Fuel className="w-4 h-4 text-red-400" />}
              rows={r.issues.unpricedFuel}
              tone="text-red-400"
              href="/admin/prices"
            />
          </div>
        </>
      )}
    </div>
  );
}

function IssueCard({
  title, hint, icon, rows, tone, href,
}: {
  title: string; hint: string; icon: React.ReactNode; rows: ReadinessAsset[]; tone: string; href?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-[#121420] border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-white flex items-center gap-2">{icon}{title}</span>
        <span className={`text-xs font-bold ${tone}`}>{rows.length}</span>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {rows.slice(0, 16).map((a) => (
          <Link
            key={a.code}
            href={`/fleet/${a.code}`}
            className="text-[10px] font-mono font-bold bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg px-2 py-1"
            title={a.label}
          >
            {a.code}
          </Link>
        ))}
        {rows.length > 16 && <span className="text-[10px] text-gray-500 self-center">+{rows.length - 16} more</span>}
      </div>
      {href && (
        <Link href={href} className="text-[10px] text-indigo-400 hover:underline mt-2 inline-block">
          Fix →
        </Link>
      )}
    </div>
  );
}
