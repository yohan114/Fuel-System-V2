import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getSiteOverview, type SiteMonthOverview } from "@/lib/reports/siteOverview";
import { currentMonthPeriod } from "@/lib/billing/period";
import { Building2, ChevronLeft, ChevronRight, Target, TrendingDown, TrendingUp, Fuel } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ ym?: string }>;
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fmtL(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtRs(cents: number) {
  return `Rs ${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function shiftYm(ym: string, delta: number) {
  const idx = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function monthTitle(ym: string) {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default async function SitesPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const projectId = session.role === "USER" ? session.projectId ?? undefined : undefined;
  const isAdmin = session.role === "ADMIN";

  const sp = await props.searchParams;
  const ym = sp.ym && YM_RE.test(sp.ym) ? sp.ym : currentMonthPeriod().periodKey;
  const data = await getSiteOverview({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), projectId });

  const paceTag = data.monthComplete ? "vs budget" : "pace";

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-400" /> Site Fuel Overview
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Fuel drawn per site in {monthTitle(ym)}
            {data.monthComplete ? "" : ` — day ${data.elapsedDays} of ${data.daysInMonth}, forecasts are run-rate projections`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/sites?ym=${shiftYm(ym, -1)}`} className="p-2 rounded-xl bg-[#1b1e30] border border-white/5 text-gray-400 hover:text-white" aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <form method="GET" action="/sites" className="flex items-center gap-2">
            <input type="month" name="ym" defaultValue={ym} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5">Apply</button>
          </form>
          <Link href={`/sites?ym=${shiftYm(ym, 1)}`} className="p-2 rounded-xl bg-[#1b1e30] border border-white/5 text-gray-400 hover:text-white" aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="Total litres" value={`${fmtL(data.totals.litres)} L`} className="text-white" />
        <Kpi label="Total cost" value={fmtRs(data.totals.costCents)} className="text-white" />
        <Kpi label="Fuel issues" value={`${data.totals.issueCount}`} className="text-gray-300" />
        <Kpi
          label={data.monthComplete ? "Litre budgets (set)" : "Forecast vs budgets"}
          value={
            data.totals.budgetLitres > 0
              ? data.monthComplete
                ? `${fmtL(data.totals.litres)} / ${fmtL(data.totals.budgetLitres)} L`
                : `${fmtL(data.totals.forecastLitres)} / ${fmtL(data.totals.budgetLitres)} L`
              : "No budgets set"
          }
          className={data.totals.budgetLitres > 0 && data.totals.forecastLitres > data.totals.budgetLitres ? "text-rose-400" : "text-emerald-400"}
        />
      </div>

      {data.sites.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-10 text-center text-xs text-gray-500">
          No sites or fuel activity for this month.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.sites.map((s) => (
            <SiteCard key={s.projectId} site={s} ym={ym} paceTag={paceTag} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        Numbers follow the Reports Console attribution (an issue counts toward its vehicle&apos;s current site).{" "}
        <Link href={`/reports?from=${ym}-01&to=${ym}-${String(data.daysInMonth).padStart(2, "0")}`} className="text-indigo-400 hover:underline">Open in Reports</Link>
        {isAdmin && (
          <>
            {" · "}
            <Link href="/admin/budgets" className="text-indigo-400 hover:underline">Set monthly budgets</Link>
          </>
        )}
      </p>
    </div>
  );
}

function SiteCard({ site, ym, paceTag, isAdmin }: { site: SiteMonthOverview; ym: string; paceTag: string; isAdmin: boolean }) {
  const maxTrend = Math.max(...site.trend.map((t) => t.litres), 1);
  const hasBudget = site.budgetLitres !== null && site.budgetLitres > 0;
  const usedPct = hasBudget ? (site.litres / site.budgetLitres!) * 100 : 0;
  const pace = site.paceVsBudgetPct;
  const over = pace !== null && pace > 0;
  const paceClass = pace === null ? "" : pace <= 0 ? "text-emerald-400" : pace <= 0.15 ? "text-amber-400" : "text-rose-400";

  const inner = (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-md hover:border-indigo-500/30 transition-colors h-full flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-sm font-bold text-white block">{site.name}</span>
          <span className="text-[10px] font-mono text-gray-500">{site.code}</span>
        </div>
        {/* 6-month sparkline (single series; native tooltips per bar) */}
        <div className="flex items-end gap-[3px] h-8" aria-hidden="true">
          {site.trend.map((t, i) => (
            <div
              key={t.periodKey}
              title={`${t.periodKey}: ${fmtL(t.litres)} L`}
              className={`w-1.5 rounded-sm ${i === site.trend.length - 1 ? "bg-indigo-300" : "bg-indigo-400/50"}`}
              style={{ height: `${Math.max((t.litres / maxTrend) * 100, 4)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-white">{fmtL(site.litres)} L</span>
        <span className="text-xs text-gray-400">{fmtRs(site.costCents)}</span>
      </div>
      <div className="flex gap-4 text-[11px] text-gray-400">
        <span><Fuel className="w-3 h-3 inline mr-1 text-gray-500" />{site.issueCount} issues</span>
        <span>{site.activeAssets} vehicles fueled</span>
      </div>

      {hasBudget ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400 flex items-center gap-1">
              <Target className="w-3 h-3 text-gray-500" /> {fmtL(site.litres)} / {fmtL(site.budgetLitres!)} L budget
            </span>
            {pace !== null && (
              <span className={`font-bold flex items-center gap-1 ${paceClass}`}>
                {over ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {over ? "+" : ""}{Math.round(pace * 100)}% {paceTag}
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full ${usedPct > 100 ? "bg-rose-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(usedPct, 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500">
          No litre budget set{isAdmin && site.projectId !== "unassigned" ? " — add one under Fuel Budgets" : ""}.
        </div>
      )}

      {site.topConsumers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
          {site.topConsumers.slice(0, 3).map((c) => (
            <span key={c.code} className="text-[10px] font-mono bg-white/5 text-gray-300 rounded-lg px-2 py-1">
              {c.code} · {fmtL(c.litres)} L
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // The unassigned pool has no project page to drill into.
  if (site.projectId === "unassigned") return inner;
  return (
    <Link href={`/sites/${encodeURIComponent(site.code)}?ym=${ym}`} className="block h-full">
      {inner}
    </Link>
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
