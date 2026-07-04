import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentMonthPeriod } from "@/lib/billing/period";
import { runInvariantChecks } from "@/lib/integrity/invariants";
import { DatabaseZap, Gauge, Coins, ShieldCheck } from "lucide-react";

export default async function DataQualityPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const period = currentMonthPeriod();

  // Active vehicles with no meter reading this month.
  const activeAssets = await prisma.asset.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, category: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: { code: "asc" },
  });
  const readThisMonth = await prisma.meterReading.findMany({
    where: { readingDate: { gte: period.start, lte: period.end } },
    select: { assetId: true },
    distinct: ["assetId"],
  });
  const readSet = new Set(readThisMonth.map((r) => r.assetId));
  const noReading = activeAssets.filter((a) => !readSet.has(a.id));

  // Active vehicles with no rate card (cannot be billed / no fuel-derived rate).
  const noRate = await prisma.asset.findMany({
    where: { status: "ACTIVE", rentalRate: { is: null } },
    select: { id: true, code: true, category: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: { code: "asc" },
  });

  const invariants = await runInvariantChecks();
  const failing = invariants.filter((c) => c.count > 0).length;

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <DatabaseZap className="w-5 h-5 text-indigo-400" /> Data Quality
        </h1>
        <p className="text-xs text-gray-400 mt-1">Gaps that weaken billing accuracy and integrity checks.</p>
      </div>

      <Section
        title={`Invariant checks (${invariants.length - failing}/${invariants.length} passing)`}
        icon={<ShieldCheck className={`w-4 h-4 ${failing === 0 ? "text-emerald-400" : "text-rose-400"}`} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {invariants.map((c) => (
            <div key={c.key} className="bg-[#1b1e30] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">{c.name}</span>
                {c.count === 0 ? (
                  <span className="text-[10px] font-bold rounded-lg px-2 py-1 bg-emerald-500/10 text-emerald-400">PASS</span>
                ) : (
                  <span className="text-[10px] font-bold rounded-lg px-2 py-1 bg-rose-500/10 text-rose-400">{c.count} FOUND</span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">{c.description}</p>
              {c.samples.length > 0 && (
                <p className="text-[10px] font-mono text-gray-400 mt-1.5 truncate" title={c.samples.join(", ")}>
                  {c.samples.join(", ")}{c.count > c.samples.length ? ", …" : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={`No meter reading this month (${noReading.length})`} icon={<Gauge className="w-4 h-4 text-amber-400" />}>
        {noReading.length === 0 ? (
          <Clear />
        ) : (
          <AssetGrid rows={noReading} />
        )}
      </Section>

      <Section title={`No rate card (${noRate.length})`} icon={<Coins className="w-4 h-4 text-red-400" />}>
        {noRate.length === 0 ? (
          <Clear />
        ) : (
          <AssetGrid rows={noRate} />
        )}
      </Section>
    </div>
  );
}

function AssetGrid({ rows }: { rows: { id: string; code: string; category: { name: string }; project: { name: string } | null }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {rows.map((a) => (
        <Link key={a.id} href={`/fleet/${a.code}`} className="bg-[#1b1e30] border border-white/5 hover:border-indigo-500/30 rounded-xl px-3 py-2.5 text-xs">
          <span className="font-bold text-white block">{a.code}</span>
          <span className="text-[10px] text-gray-500 block truncate">{a.category.name}{a.project ? ` · ${a.project.name}` : ""}</span>
        </Link>
      ))}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2 flex items-center gap-2">{icon}{title}</h3>
      {children}
    </div>
  );
}

function Clear() {
  return <div className="text-center py-6 text-xs text-emerald-400">No gaps found. ✓</div>;
}
