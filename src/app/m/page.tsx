import React from "react";
import { prisma } from "@/lib/db";
import { loadCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { Fuel, PlusCircle, Gauge, Activity, Clock, ShieldCheck, ChevronRight, Droplet } from "lucide-react";
import { colomboDayKey } from "@/lib/colombo-date";

export default async function MobileHomePage() {
  const user = await loadCurrentUser();
  if (!user) return null;

  // Resolve active bulk tank for this user
  let tank = user.bulkTankId
    ? await prisma.bulkTank.findUnique({
        where: { id: user.bulkTankId },
      })
    : await prisma.bulkTank.findFirst({
        orderBy: { balance: "desc" },
      });

  const todayKey = colomboDayKey(new Date());
  const todayStart = new Date(`${todayKey}T00:00:00+05:30`);

  // Recent issues today
  const recentIssues = await prisma.fuelIssue.findMany({
    where: {
      voided: false,
      issueDate: { gte: todayStart },
      ...(tank ? { bulkTankId: tank.id } : {}),
    },
    take: 5,
    orderBy: { createdAt: "desc" },
    include: {
      asset: { select: { code: true, regNo: true } },
    },
  });

  const todayLitres = recentIssues.reduce((sum, i) => sum + i.litres, 0);

  const fillPercent = tank && tank.capacity > 0
    ? Math.min(100, Math.max(0, Math.round((tank.balance / tank.capacity) * 100)))
    : 0;

  return (
    <div className="space-y-4">
      {/* Tank Balance Card */}
      {tank ? (
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <div className="flex items-center gap-1.5 font-medium">
              <Droplet className="w-4 h-4 text-blue-400" />
              <span>{tank.name}</span>
            </div>
            <span className="font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full text-[11px] border border-blue-500/20">
              {tank.fuelKind.replace("_", " ")}
            </span>
          </div>

          <div className="flex items-baseline justify-between mb-2">
            <div>
              <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
                {tank.balance.toLocaleString()} <span className="text-sm font-normal text-slate-400">L</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Capacity: {tank.capacity.toLocaleString()} L
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold font-mono text-blue-400">
                {fillPercent}%
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                Level
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                fillPercent < 20
                  ? "bg-red-500"
                  : fillPercent < 40
                  ? "bg-amber-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${fillPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Primary Action Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/m/issue"
          className="flex flex-col justify-between p-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-3">
            <Fuel className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">Dispense Fuel</div>
            <div className="text-xs text-blue-100/80 mt-0.5">One-tap issue & photo</div>
          </div>
        </Link>

        <Link
          href="/m/request"
          className="flex flex-col justify-between p-4 rounded-2xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-white active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center mb-3">
            <PlusCircle className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">Fuel Request</div>
            <div className="text-xs text-slate-400 mt-0.5">Submit vehicle draw</div>
          </div>
        </Link>

        <Link
          href="/m/readings"
          className="flex flex-col justify-between p-4 rounded-2xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-white active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
            <Gauge className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">Meter Reading</div>
            <div className="text-xs text-slate-400 mt-0.5">Record km / hours</div>
          </div>
        </Link>

        <Link
          href="/m/condition"
          className="flex flex-col justify-between p-4 rounded-2xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-white active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center mb-3">
            <Activity className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">Fleet Status</div>
            <div className="text-xs text-slate-400 mt-0.5">Working / Breakdown</div>
          </div>
        </Link>
      </div>

      {/* Today's Activity Summary */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Today&apos;s Dispenses ({todayLitres.toFixed(1)} L)
            </span>
          </div>
          <Link
            href="/fuel/issues"
            className="text-xs text-blue-400 flex items-center hover:underline"
          >
            <span>All</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentIssues.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            No fuel dispenses recorded yet today.
          </div>
        ) : (
          <div className="space-y-2">
            {recentIssues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/50 text-xs"
              >
                <div>
                  <div className="font-bold text-white tracking-wide">
                    {issue.asset.code}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(issue.issueDate).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {issue.meterReading ? ` • ${issue.meterReading} ${issue.readingType || ""}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-blue-400 text-sm">
                    {issue.litres.toFixed(1)} L
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Rs. {(issue.totalCost / 100).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
