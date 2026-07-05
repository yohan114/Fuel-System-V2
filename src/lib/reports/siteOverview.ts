import { prisma } from "../db";
import { resolvePeriod } from "../billing/period";

// Per-site monthly fuel rollup for the /sites overview. Attribution follows the
// /reports convention: an issue belongs to its asset's *current* project (the
// same rule aggregateFuelData uses), so the two screens always agree. Trend
// keys use the UTC month of issueDate, mirroring aggregate's dayKey idiom.

export interface SiteMonthOverview {
  projectId: string; // "unassigned" pseudo-id for assets without a project
  name: string;
  code: string; // "GLOBAL" for the unassigned bucket
  litres: number;
  costCents: number;
  issueCount: number;
  activeAssets: number; // distinct assets fueled this month
  budgetLitres: number | null;
  budgetAmountCents: number | null;
  forecastLitres: number; // run-rate projection (equals litres once the month is over)
  paceVsBudgetPct: number | null; // forecast/budget − 1; null when no litre budget
  topConsumers: { code: string; litres: number; costCents: number }[];
  trend: { periodKey: string; litres: number }[]; // oldest → this month (6 points)
}

export interface SiteOverviewResult {
  period: { year: number; month: number; periodKey: string; start: Date; end: Date };
  elapsedDays: number; // Colombo days elapsed within the month, clamped to [1, daysInMonth]
  daysInMonth: number;
  monthComplete: boolean;
  sites: SiteMonthOverview[];
  totals: {
    litres: number;
    costCents: number;
    issueCount: number;
    budgetLitres: number; // sum of litre budgets that exist
    forecastLitres: number;
  };
}

const TREND_MONTHS = 6;
const UNASSIGNED = { id: "unassigned", name: "Unassigned / Global Pool", code: "GLOBAL" };

function monthKeyUTC(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export async function getSiteOverview(opts: {
  year: number;
  month: number;
  projectId?: string;
  now?: Date;
}): Promise<SiteOverviewResult> {
  const period = resolvePeriod(opts.year, opts.month);
  const trendFirst = shiftMonth(opts.year, opts.month, -(TREND_MONTHS - 1));
  const trendStart = resolvePeriod(trendFirst.year, trendFirst.month).start;
  const trendKeys: string[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = shiftMonth(opts.year, opts.month, -i);
    trendKeys.push(resolvePeriod(m.year, m.month).periodKey);
  }

  const [projects, budgets, issues] = await Promise.all([
    prisma.project.findMany({
      where: opts.projectId ? { id: opts.projectId } : {},
      orderBy: { name: "asc" },
    }),
    prisma.budget.findMany({ where: { year: opts.year, month: opts.month } }),
    prisma.fuelIssue.findMany({
      where: {
        voided: false,
        issueDate: { gte: trendStart, lte: period.end },
        ...(opts.projectId ? { asset: { projectId: opts.projectId } } : {}),
      },
      select: {
        litres: true,
        totalCost: true,
        issueDate: true,
        asset: { select: { id: true, code: true, projectId: true } },
      },
    }),
  ]);

  const budgetByProject = new Map(budgets.map((b) => [b.projectId, b]));

  interface Acc {
    projectId: string;
    name: string;
    code: string;
    litres: number;
    costCents: number;
    issueCount: number;
    assets: Set<string>;
    perAsset: Map<string, { code: string; litres: number; costCents: number }>;
    trend: Map<string, number>;
  }
  const acc = new Map<string, Acc>();
  const ensure = (id: string, name: string, code: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { projectId: id, name, code, litres: 0, costCents: 0, issueCount: 0, assets: new Set(), perAsset: new Map(), trend: new Map() };
      acc.set(id, a);
    }
    return a;
  };

  // Every project shows up even with zero fuel this month.
  for (const p of projects) ensure(p.id, p.name, p.code);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  for (const issue of issues) {
    const pid = issue.asset.projectId;
    let a: Acc;
    if (pid && projectById.has(pid)) {
      const p = projectById.get(pid)!;
      a = ensure(p.id, p.name, p.code);
    } else if (pid) {
      continue; // project filter active and this asset moved projects mid-query — not ours
    } else {
      if (opts.projectId) continue;
      a = ensure(UNASSIGNED.id, UNASSIGNED.name, UNASSIGNED.code);
    }

    const key = monthKeyUTC(issue.issueDate);
    a.trend.set(key, (a.trend.get(key) || 0) + issue.litres);

    if (key !== period.periodKey) continue; // older months only feed the trend
    a.litres += issue.litres;
    a.costCents += issue.totalCost;
    a.issueCount++;
    a.assets.add(issue.asset.id);
    const pa = a.perAsset.get(issue.asset.id) || { code: issue.asset.code, litres: 0, costCents: 0 };
    pa.litres += issue.litres;
    pa.costCents += issue.totalCost;
    a.perAsset.set(issue.asset.id, pa);
  }

  // Month progress in the Colombo calendar (mirrors billing/period.ts).
  const now = opts.now ?? new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }); // YYYY-MM-DD
  const todayKey = todayStr.slice(0, 7);
  const daysInMonth = new Date(opts.year, opts.month, 0).getDate();
  let elapsedDays: number;
  let monthComplete: boolean;
  if (todayKey > period.periodKey) {
    elapsedDays = daysInMonth;
    monthComplete = true;
  } else if (todayKey < period.periodKey) {
    elapsedDays = 1; // future month: no meaningful pace yet
    monthComplete = false;
  } else {
    elapsedDays = Math.min(Math.max(Number(todayStr.slice(8, 10)), 1), daysInMonth);
    monthComplete = false;
  }

  const sites: SiteMonthOverview[] = [...acc.values()].map((a) => {
    const budget = budgetByProject.get(a.projectId);
    const forecastLitres = monthComplete ? a.litres : (a.litres / elapsedDays) * daysInMonth;
    const budgetLitres = budget?.budgetLitres ?? null;
    return {
      projectId: a.projectId,
      name: a.name,
      code: a.code,
      litres: a.litres,
      costCents: a.costCents,
      issueCount: a.issueCount,
      activeAssets: a.assets.size,
      budgetLitres,
      budgetAmountCents: budget?.budgetAmountCents ?? null,
      forecastLitres,
      paceVsBudgetPct: budgetLitres && budgetLitres > 0 ? forecastLitres / budgetLitres - 1 : null,
      topConsumers: [...a.perAsset.values()].sort((x, y) => y.litres - x.litres).slice(0, 5),
      trend: trendKeys.map((k) => ({ periodKey: k, litres: a.trend.get(k) || 0 })),
    };
  });
  sites.sort((x, y) => y.litres - x.litres || x.name.localeCompare(y.name));

  const totals = sites.reduce(
    (t, s) => {
      t.litres += s.litres;
      t.costCents += s.costCents;
      t.issueCount += s.issueCount;
      t.budgetLitres += s.budgetLitres ?? 0;
      t.forecastLitres += s.forecastLitres;
      return t;
    },
    { litres: 0, costCents: 0, issueCount: 0, budgetLitres: 0, forecastLitres: 0 }
  );

  return {
    period: { year: period.year, month: period.month, periodKey: period.periodKey, start: period.start, end: period.end },
    elapsedDays,
    daysInMonth,
    monthComplete,
    sites,
    totals,
  };
}
