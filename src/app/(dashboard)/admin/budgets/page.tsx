import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { setBudgetAction } from "@/app/actions/finance";
import { Target } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function BudgetsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const sp = await props.searchParams;
  const now = new Date();
  const cur = currentMonthPeriod(now);
  const year = parseInt(sp.year || "", 10) || cur.year;
  const month = parseInt(sp.month || "", 10) || cur.month;
  const period = resolvePeriod(year, month);

  const daysInMonth = new Date(year, month, 0).getDate();
  let elapsed: number;
  if (now < period.start) elapsed = 0;
  else if (now > period.end) elapsed = daysInMonth;
  else elapsed = now.getDate();
  const toDate = now > period.end ? period.end : now;

  const [projects, budgets, actuals] = await Promise.all([
    prisma.project.findMany({ orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { year, month } }),
    aggregateFuelData({ from: period.start, to: toDate }),
  ]);

  const budgetMap = new Map(budgets.map((b) => [b.projectId, b]));
  const actualMap = new Map(actuals.siteBreakdown.map((s) => [s.id, s]));

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Target className="w-5 h-5 text-indigo-400" /> Fuel Budgets & Forecast
          </h1>
          <p className="text-xs text-gray-400 mt-1">Per-site monthly fuel budget vs actual, with a month-end run-rate forecast. {monthLabel} ({elapsed}/{daysInMonth} days).</p>
        </div>
        <form method="GET" action="/admin/budgets" className="flex items-end gap-2">
          <input type="number" name="year" defaultValue={year} className="w-20 bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          <input type="number" name="month" min={1} max={12} defaultValue={month} className="w-16 bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2">Go</button>
        </form>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="text-gray-400 font-semibold border-b border-white/5">
              <th className="py-2.5">Site</th>
              <th className="py-2.5 text-right">Budget (L)</th>
              <th className="py-2.5 text-right">Actual (L)</th>
              <th className="py-2.5 text-right">Forecast (L)</th>
              <th className="py-2.5 text-right">Actual Cost</th>
              <th className="py-2.5">Set budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {projects.map((p) => {
              const b = budgetMap.get(p.id);
              const a = actualMap.get(p.id);
              const actualL = a?.totalLitres ?? 0;
              const forecastL = elapsed > 0 ? (actualL / elapsed) * daysInMonth : 0;
              const overBudget = b?.budgetLitres != null && forecastL > b.budgetLitres;
              return (
                <tr key={p.id} className="hover:bg-white/[0.01] align-middle">
                  <td className="py-3 font-bold text-white">{p.name}</td>
                  <td className="py-3 text-right text-gray-300">{b?.budgetLitres != null ? b.budgetLitres.toLocaleString() : "—"}</td>
                  <td className="py-3 text-right text-white font-semibold">{actualL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className={`py-3 text-right font-bold ${overBudget ? "text-red-400" : "text-emerald-400"}`}>{forecastL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="py-3 text-right text-gray-400">{rs(a?.costCents ?? 0)}</td>
                  <td className="py-3">
                    <form action={async (fd) => { "use server"; await setBudgetAction(fd); }} className="flex items-center gap-1.5">
                      <input type="hidden" name="projectId" value={p.id} />
                      <input type="hidden" name="year" value={year} />
                      <input type="hidden" name="month" value={month} />
                      <input type="number" step="1" name="budgetLitres" defaultValue={b?.budgetLitres ?? ""} placeholder="litres" className="w-24 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1.5 text-white text-[11px]" />
                      <input type="number" step="1" name="budgetAmount" defaultValue={b?.budgetAmountCents != null ? b.budgetAmountCents / 100 : ""} placeholder="Rs." className="w-24 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1.5 text-white text-[11px]" />
                      <button type="submit" className="bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold rounded-lg px-3 py-1.5">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
