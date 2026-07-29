import { isSiteUser } from "@/lib/roles";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import { indexAssignments, assignedSiteOn } from "@/lib/fuel/site-attribution";
import { FUEL_KINDS } from "@/lib/fuel-kinds";
import React from "react";
import { prisma } from "@/lib/db";
import { getSession, requireUser } from "@/lib/auth";
import QuickActions from "./components/QuickActions";
import DashboardCharts from "./components/DashboardCharts";
import ConditionWidget from "./components/ConditionWidget";
import { approveRequestAction, rejectRequestAction } from "@/app/actions/fuel";
import { 
  Fuel, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  FileClock, 
  Coins, 
  Gauge, 
  PlusCircle,
  Clock,
  UserCheck
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  // Calculate current calendar month boundaries in Colombo timezone
  const now = new Date();
  const colomboTodayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [colomboYear, colomboMonth, colomboDay] = colomboTodayStr.split("-").map(Number);
  
  const startOfMonth = new Date(colomboYear, colomboMonth - 1, 1);
  const endOfMonth = new Date(colomboYear, colomboMonth, 0, 23, 59, 59, 999);
  const logDate = new Date(colomboYear, colomboMonth - 1, colomboDay);

  const colomboHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Colombo",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  const isConditionLocked = colomboHour < 8 || colomboHour >= 17;
  const lockMessage = isConditionLocked
    ? (colomboHour < 8 ? "Closed (Opens at 08:00 AM)" : "Closed (Locked at 17:00 PM)")
    : "Open (Locks at 17:00 PM)";

  // A site user (USER / SITE_PUMP) sees ONLY their own site; admin/allocator are
  // unrestricted. A site user with no site assigned sees NOTHING — never a
  // cross-site fallback.
  const isSite = isSiteUser(user.role);
  const siteId = user.projectId ?? null;

  // Two scoping sets for a site user (both null = unrestricted admin/allocator):
  //   • currentFleetIds — vehicles posted to the site *now* (live fleet + approvals).
  //   • fuelAllowedIds  — vehicles *ever* posted to the site (∪ pinned): the
  //     candidate pool whose fuel is then attributed per-issue to the site.
  // An empty Set means "site user with no site → show nothing".
  let currentFleetIds: Set<string> | null = null;
  let fuelAllowedIds: Set<string> | null = null;
  let attributionIdx: ReturnType<typeof indexAssignments> | null = null;

  if (isSite) {
    if (!siteId) {
      currentFleetIds = new Set();
      fuelAllowedIds = new Set();
    } else {
      currentFleetIds = (await visibleAssetIdsForUser(user, now)) ?? new Set();
      const [spans, pinned] = await Promise.all([
        prisma.assetAssignment.findMany({ where: { projectId: siteId }, select: { assetId: true }, distinct: ["assetId"] }),
        prisma.asset.findMany({ where: { projectId: siteId }, select: { id: true } }),
      ]);
      fuelAllowedIds = new Set<string>([...spans.map((s) => s.assetId), ...pinned.map((a) => a.id)]);
      const assignments = await prisma.assetAssignment.findMany({
        where: { assetId: { in: [...fuelAllowedIds] } },
        select: { assetId: true, projectId: true, startDate: true, endDate: true },
      });
      attributionIdx = indexAssignments(assignments);
    }
  }

  // A fuel issue counts for the site only when the vehicle was *assigned* there on
  // the issue date (falling back to its current pin) — mirrors the Fuel Issues log.
  const issueMatchesSite = (assetId: string, issueDate: Date, assetPin: string | null): boolean => {
    if (!isSite) return true;
    if (!siteId || !attributionIdx) return false;
    const pid = assignedSiteOn(attributionIdx, assetId, issueDate) ?? assetPin;
    return pid === siteId;
  };

  const assetIdIn = (ids: Set<string> | null) => (ids ? { assetId: { in: [...ids] } } : {});

  // 1. KPI metrics — Active Fleet + Pending Approvals scoped to the site's live fleet.
  const activeAssetsCount = await prisma.asset.count({
    where: {
      status: "ACTIVE",
      ...(currentFleetIds ? { id: { in: [...currentFleetIds] } } : {}),
    },
  });

  const pendingRequestsCount = await prisma.fuelRequest.count({
    where: { status: "PENDING", ...assetIdIn(currentFleetIds) },
  });

  // 2. This month's fuel, attributed to the site. Fetch the candidate issues, keep
  // only those the attribution assigns here; the KPI sums (Spend/Volume), the
  // daily trend and the product split all derive from this one filtered list.
  const monthRaw = await prisma.fuelIssue.findMany({
    where: {
      issueDate: { gte: startOfMonth, lte: endOfMonth },
      ...assetIdIn(fuelAllowedIds),
    },
    orderBy: { issueDate: "asc" },
    include: { asset: { select: { projectId: true } } },
  });
  const issuesThisMonth = isSite
    ? monthRaw.filter((i) => issueMatchesSite(i.assetId, i.issueDate, i.asset.projectId))
    : monthRaw;

  let monthLitres = 0;
  let monthCost = 0;
  for (const i of issuesThisMonth) {
    monthLitres += i.litres;
    monthCost += i.totalCost;
  }

  // Litres/cost per fuel product this month (diesel, petrol, kerosene …)
  const kindTotals: Record<string, { litres: number; cost: number }> = {};

  // Group by day for the chart
  const dailyGroups: Record<string, { date: string; litres: number; cost: number }> = {};
  
  // Pre-fill days of the month up to current day to show a continuous timeline
  const currentDay = now.getDate();
  for (let d = 1; d <= currentDay; d++) {
    const dayStr = d.toString().padStart(2, "0");
    dailyGroups[dayStr] = { date: dayStr, litres: 0, cost: 0 };
  }

  for (const issue of issuesThisMonth) {
    const kt = (kindTotals[issue.fuelKind] ??= { litres: 0, cost: 0 });
    kt.litres += issue.litres;
    kt.cost += issue.totalCost;

    const dayStr = issue.issueDate.getDate().toString().padStart(2, "0");
    if (dailyGroups[dayStr]) {
      dailyGroups[dayStr].litres += issue.litres;
      dailyGroups[dayStr].cost += issue.totalCost;
    } else {
      dailyGroups[dayStr] = { date: dayStr, litres: issue.litres, cost: issue.totalCost };
    }
  }

  const trendData = Object.values(dailyGroups).sort((a, b) => a.date.localeCompare(b.date));

  // 3. Latest active price per product (diesel, petrol, kerosene)
  const priceRows = await prisma.fuelPrice.findMany({ orderBy: { effectiveFrom: "desc" } });
  const pumpPrices = FUEL_KINDS.map((k) => ({
    kind: k,
    price: priceRows.find((p) => p.fuelKind === k.code) ?? null,
  })).filter((p) => p.price != null || p.kind.code === "AUTO_DIESEL" || p.kind.code === "SUPER_DIESEL");

  // 4. Fetch assets for Condition Widget and Quick Actions — the site's live fleet.
  const assets = await prisma.asset.findMany({
    where: {
      status: { in: ["ACTIVE", "INACTIVE"] },
      ...(currentFleetIds ? { id: { in: [...currentFleetIds] } } : {}),
    },
    select: {
      id: true,
      code: true,
      meterType: true,
      regNo: true,
      status: true,
      typeLabel: true,
      // Which site the machine belongs to, plus who reported the condition and
      // when — a breakdown is only actionable if you know where it is and who
      // to call about it.
      project: { select: { code: true, name: true } },
      dailyConditions: {
        where: { logDate },
        take: 1,
        select: {
          status: true,
          note: true,
          createdAt: true,
          recordedBy: { select: { name: true } },
        },
      }
    },
    orderBy: { code: "asc" },
  });

  // 5. Recent dispatches — attributed to the site (over-fetch, then filter + trim).
  const recentRaw = await prisma.fuelIssue.findMany({
    where: { ...assetIdIn(fuelAllowedIds) },
    take: fuelAllowedIds ? 40 : 5,
    orderBy: { issueDate: "desc" },
    include: {
      asset: true,
      issuedBy: true,
    },
  });
  const recentIssues = (isSite
    ? recentRaw.filter((i) => issueMatchesSite(i.assetId, i.issueDate, i.asset.projectId))
    : recentRaw
  ).slice(0, 5);

  // 6. Pending requests — the site's live fleet only.
  const pendingRequests = await prisma.fuelRequest.findMany({
    where: { status: "PENDING", ...assetIdIn(currentFleetIds) },
    take: 5,
    orderBy: { createdAt: "desc" },
    include: {
      asset: true,
      requestedBy: true,
    },
  });

  // 7. Find recent warning alerts (like failed price scraping)
  const scraperAlert = await prisma.auditLog.findFirst({
    where: {
      action: "PRICE_REFRESH",
      summary: { contains: "failed" },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Ayubowan, {session.name}</h1>
          <p className="text-xs text-gray-400 mt-1 font-medium">
            Here is the fleet fuel dashboard for {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="text-sm font-semibold bg-[#121420] border border-white/5 px-4 py-2.5 rounded-xl text-gray-300 w-fit">
          📅 {now.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}
        </div>
      </div>

      {/* Quick Actions Panel — fuel issuing is 24/7, never time-locked */}
      <QuickActions
        assets={assets.filter((a) => a.status === "ACTIVE")}
        isAdmin={isAdmin}
        isLocked={false}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Cost Spend */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg flex items-center gap-5">
          <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider block">Spend This Month</span>
            <span className="text-lg font-bold text-white block mt-0.5">
              Rs. {(monthCost / 100).toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Volume Pumped */}
        <Link href="/sites" className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg flex items-center gap-5 hover:border-indigo-500/30 transition-colors">
          <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400">
            <Fuel className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider block">Volume Dispensed</span>
            <span className="text-lg font-bold text-white block mt-0.5">
              {monthLitres.toLocaleString("en-US", { maximumFractionDigits: 1 })} Litres
            </span>
            <span className="text-[10px] text-indigo-400 block mt-0.5">View by site →</span>
          </div>
        </Link>

        {/* Active Fleet */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg flex items-center gap-5">
          <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider block">Active Fleet</span>
            <span className="text-lg font-bold text-white block mt-0.5">
              {activeAssetsCount} Assets
            </span>
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg flex items-center gap-5">
          <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-400">
            <FileClock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider block">Pending Approvals</span>
            <span className="text-lg font-bold text-white block mt-0.5">
              {pendingRequestsCount} Requests
            </span>
          </div>
        </div>
      </div>

      {/* Warnings & Active Prices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Warnings / Alerts */}
        <div className="lg:col-span-2 bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Active System Warnings
            </h3>
            
            <div className="space-y-3">
              {pendingRequestsCount > 0 && isAdmin && (
                <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/10 rounded-xl p-3.5 text-xs text-amber-200">
                  <Clock className="w-4 h-4 flex-shrink-0" />
                  <span>You have <strong>{pendingRequestsCount} pending requests</strong> that require review and approval.</span>
                </div>
              )}

              {scraperAlert && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/10 rounded-xl p-3.5 text-xs text-red-200">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Price Scraper failed: <em>{scraperAlert.summary.split(":")[1]?.trim() || "HTTP 403 Blocked"}</em>. 
                    Prices continue to reference active manual settings.
                  </span>
                </div>
              )}

              {pendingRequestsCount === 0 && !scraperAlert && (
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/10 rounded-xl p-3.5 text-xs text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>All fuel requests processed. System prices are stable and no active issues detected.</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/5 text-[10px] text-gray-500 font-semibold">
            SECURE ACCESS: HASHED AND CRYPTOGRAPHIC COOKIE LOGS ARE ACTIVE.
          </div>
        </div>

        {/* Current Prices */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
            Ceypetco Pump Prices
          </h3>
          <div className="space-y-4">
            {pumpPrices.map(({ kind, price }) => (
              <div key={kind.code} className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
                <div>
                  <span className="text-xs text-gray-400 block font-semibold">{kind.short}</span>
                  <span className="text-xs text-[10px] text-gray-500 block">{kind.label}</span>
                </div>
                <span className={`text-md font-bold ${price ? "text-white" : "text-gray-600"}`}>
                  {price ? `Rs. ${(price.pricePerLitre / 100).toFixed(2)}` : "—"}
                </span>
              </div>
            ))}
          </div>
          {isAdmin && (
            <Link 
              href="/admin/prices" 
              className="mt-4 block text-center text-xs text-indigo-400 hover:text-indigo-300 font-semibold hover:underline"
            >
              Manage Prices & Overrides &rarr;
            </Link>
          )}
        </div>
      </div>

      {/* Daily Condition Logger */}
      <ConditionWidget
        initialAssets={assets}
        isLocked={isConditionLocked}
        lockMessage={lockMessage}
        isAdmin={isAdmin}
      />

      {/* Visual Analytics Charts */}
      <DashboardCharts 
        trendData={trendData}
        kindSplit={FUEL_KINDS.filter((k) => kindTotals[k.code]).map((k) => ({
          name: k.short,
          value: kindTotals[k.code].litres,
          cost: kindTotals[k.code].cost,
        }))}
      />

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Pending Requests Log */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">Pending Fuel Requests</h3>
            <Link href="/fuel/requests" className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold">
              View All
            </Link>
          </div>

          <div className="space-y-3">
            {pendingRequests.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">
                No pending requests found.
              </div>
            ) : (
              pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{req.asset.code}</span>
                      <span className="text-[10px] text-gray-400 font-semibold">({req.requestedLitres}L)</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Requested by {req.requestedBy.name} • {new Date(req.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex items-center gap-1.5">
                      <form action={async () => {
                        "use server";
                        await approveRequestAction(req.id, "Approved from Dashboard");
                      }}>
                        <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-2.5 py-1.5 rounded-lg text-[10px]">
                          Approve
                        </button>
                      </form>
                      <form action={async () => {
                        "use server";
                        await rejectRequestAction(req.id, "Rejected from Dashboard");
                      }}>
                        <button type="submit" className="bg-white/5 hover:bg-red-500/10 hover:text-red-400 text-gray-400 font-semibold px-2.5 py-1.5 rounded-lg border border-white/5 text-[10px]">
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : (
                    <span className="text-[10px] bg-amber-500/15 text-amber-300 px-2 py-1 rounded-md font-semibold">
                      PENDING
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Recent issues log */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">Recent Fuel Dispatches</h3>
            <Link href="/fuel/issues" className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold">
              View All
            </Link>
          </div>

          <div className="space-y-3">
            {recentIssues.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">
                No dispatches recorded yet.
              </div>
            ) : (
              recentIssues.map((issue) => (
                <div key={issue.id} className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{issue.asset.code}</span>
                      <span className="text-[10px] text-gray-500 block capitalize">
                        {issue.fuelKind.replace("_", " ").toLowerCase()} ({issue.litres}L)
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Issued by {issue.issuedBy.name} • {new Date(issue.issueDate).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-white block">Rs. {(issue.totalCost / 100).toLocaleString("en-LK")}</span>
                    <span className="text-[9px] text-gray-500 uppercase font-semibold">{issue.source}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}
