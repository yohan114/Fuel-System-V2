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

  const isScoped = user.role === "USER" && user.projectId;

  // 1. Fetch KPI metrics
  const monthlyIssues = await prisma.fuelIssue.aggregate({
    where: {
      issueDate: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
      ...(isScoped ? {
        asset: { projectId: user.projectId }
      } : {}),
    },
    _sum: {
      litres: true,
      totalCost: true,
    },
    _count: {
      id: true,
    }
  });

  const activeAssetsCount = await prisma.asset.count({
    where: {
      status: "ACTIVE",
      ...(isScoped ? {
        projectId: user.projectId
      } : {}),
    },
  });

  const pendingRequestsCount = await prisma.fuelRequest.count({
    where: {
      status: "PENDING",
      ...(isScoped ? {
        asset: { projectId: user.projectId }
      } : {}),
    },
  });

  // 2. Fetch fuel splits
  const issuesThisMonth = await prisma.fuelIssue.findMany({
    where: {
      issueDate: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
      ...(isScoped ? {
        asset: { projectId: user.projectId }
      } : {}),
    },
    orderBy: {
      issueDate: "asc",
    },
  });

  let autoDieselLitres = 0;
  let superDieselLitres = 0;
  let autoDieselCost = 0;
  let superDieselCost = 0;

  // Group by day for the chart
  const dailyGroups: Record<string, { date: string; litres: number; cost: number }> = {};
  
  // Pre-fill days of the month up to current day to show a continuous timeline
  const currentDay = now.getDate();
  for (let d = 1; d <= currentDay; d++) {
    const dayStr = d.toString().padStart(2, "0");
    dailyGroups[dayStr] = { date: dayStr, litres: 0, cost: 0 };
  }

  for (const issue of issuesThisMonth) {
    if (issue.fuelKind === "AUTO_DIESEL") {
      autoDieselLitres += issue.litres;
      autoDieselCost += issue.totalCost;
    } else {
      superDieselLitres += issue.litres;
      superDieselCost += issue.totalCost;
    }

    const dayStr = issue.issueDate.getDate().toString().padStart(2, "0");
    if (dailyGroups[dayStr]) {
      dailyGroups[dayStr].litres += issue.litres;
      dailyGroups[dayStr].cost += issue.totalCost;
    } else {
      dailyGroups[dayStr] = { date: dayStr, litres: issue.litres, cost: issue.totalCost };
    }
  }

  const trendData = Object.values(dailyGroups).sort((a, b) => a.date.localeCompare(b.date));

  // 3. Fetch active prices
  const autoPriceRecord = await prisma.fuelPrice.findFirst({
    where: { fuelKind: "AUTO_DIESEL" },
    orderBy: { effectiveFrom: "desc" },
  });
  const superPriceRecord = await prisma.fuelPrice.findFirst({
    where: { fuelKind: "SUPER_DIESEL" },
    orderBy: { effectiveFrom: "desc" },
  });

  const autoPrice = autoPriceRecord ? autoPriceRecord.pricePerLitre / 100 : 407.00;
  const superPrice = superPriceRecord ? superPriceRecord.pricePerLitre / 100 : 478.00;

  // 4. Fetch assets for Condition Widget and Quick Actions
  const assets = await prisma.asset.findMany({
    where: { 
      status: { in: ["ACTIVE", "INACTIVE"] },
      ...(isScoped ? { projectId: user.projectId } : {}),
    },
    select: { 
      id: true, 
      code: true, 
      meterType: true, 
      regNo: true, 
      status: true,
      dailyConditions: {
        where: { logDate },
        take: 1,
      }
    },
    orderBy: { code: "asc" },
  });

  // 5. Fetch recent issues
  const recentIssues = await prisma.fuelIssue.findMany({
    where: {
      ...(isScoped ? { asset: { projectId: user.projectId } } : {}),
    },
    take: 5,
    orderBy: { issueDate: "desc" },
    include: {
      asset: true,
      issuedBy: true,
    },
  });

  // 6. Fetch pending requests
  const pendingRequests = await prisma.fuelRequest.findMany({
    where: { 
      status: "PENDING",
      ...(isScoped ? { asset: { projectId: user.projectId } } : {}),
    },
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

      {/* Quick Actions Panel */}
      <QuickActions 
        assets={assets.filter((a) => a.status === "ACTIVE")} 
        isAdmin={isAdmin} 
        isLocked={isConditionLocked}
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
              Rs. {((monthlyIssues._sum.totalCost || 0) / 100).toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
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
              {(monthlyIssues._sum.litres || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} Litres
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
            <div className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
              <div>
                <span className="text-xs text-gray-400 block font-semibold">Auto Diesel</span>
                <span className="text-xs text-[10px] text-gray-500 block">Lanka Auto Diesel</span>
              </div>
              <span className="text-md font-bold text-white">Rs. {autoPrice.toFixed(2)}</span>
            </div>

            <div className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
              <div>
                <span className="text-xs text-gray-400 block font-semibold">Super Diesel</span>
                <span className="text-xs text-[10px] text-gray-500 block">Lanka Super Diesel E4</span>
              </div>
              <span className="text-md font-bold text-white">Rs. {superPrice.toFixed(2)}</span>
            </div>
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
        autoDieselLitres={autoDieselLitres}
        superDieselLitres={superDieselLitres}
        autoDieselCost={autoDieselCost}
        superDieselCost={superDieselCost}
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
