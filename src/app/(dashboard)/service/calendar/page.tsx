import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isSiteUser } from "@/lib/roles";
import { getFleetServiceStatus } from "@/lib/service/fleet";
import {
  Calendar as CalendarIcon,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Wrench,
  ChevronRight,
  ExternalLink,
  MapPin,
  HelpCircle,
} from "lucide-react";

interface PageProps {
  searchParams: Promise<{ projectId?: string }>;
}

function formatDate(d: Date | null): string {
  if (!d) return "Not scheduled";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ServiceCalendarPage(props: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await props.searchParams;
  let projectId = isSiteUser(session.role) ? session.projectId ?? undefined : sp.projectId;

  const { rows, counts } = await getFleetServiceStatus({ projectId });

  const now = new Date();
  const next7Days = new Date(now.getTime() + 7 * 86400000);
  const next30Days = new Date(now.getTime() + 30 * 86400000);

  // Group by timeline category
  const overdue = rows.filter((r) => r.state === "OVERDUE");
  const dueThisWeek = rows.filter(
    (r) =>
      r.state === "DUE_SOON" ||
      (r.projectedDueDate && r.projectedDueDate >= now && r.projectedDueDate <= next7Days)
  );
  const dueThisMonth = rows.filter(
    (r) =>
      r.state === "OK" &&
      r.projectedDueDate &&
      r.projectedDueDate > next7Days &&
      r.projectedDueDate <= next30Days
  );
  const scheduledLater = rows.filter(
    (r) =>
      r.state === "OK" &&
      (!r.projectedDueDate || r.projectedDueDate > next30Days)
  );
  const unknown = rows.filter((r) => r.state === "UNKNOWN");

  return (
    <div className="space-y-6">
      {/* Header and Sub-navigation */}
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">
              Service Calendar & Due Forecast
            </h1>
            <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-mono">
              MONTH VIEW
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Predictive maintenance schedule based on run-rates and meter intervals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/service"
            className="text-xs px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
          >
            Planner View
          </Link>
          <Link
            href="/service/log"
            className="text-xs px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
          >
            Service History Log
          </Link>
          <Link
            href="/service/new"
            className="text-xs px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Record Service</span>
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-red-950/20 border border-red-900/40">
          <div className="flex items-center justify-between text-xs text-red-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Overdue</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{counts.overdue}</div>
          <div className="text-[11px] text-red-300/70 mt-0.5">Exceeded service interval</div>
        </div>

        <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-900/40">
          <div className="flex items-center justify-between text-xs text-amber-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Due Soon</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{dueThisWeek.length}</div>
          <div className="text-[11px] text-amber-300/70 mt-0.5">Due in the next 7 days</div>
        </div>

        <div className="p-4 rounded-2xl bg-blue-950/20 border border-blue-900/40">
          <div className="flex items-center justify-between text-xs text-blue-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">This Month</span>
            <CalendarIcon className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{dueThisMonth.length}</div>
          <div className="text-[11px] text-blue-300/70 mt-0.5">Forecasted in 8–30 days</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Active Fleet</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{counts.tracked}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{counts.ok} in good standing</div>
        </div>
      </div>

      {/* Timeline Forecast Groups */}
      <div className="space-y-6">
        {/* 1. Critical: Overdue Services */}
        {overdue.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-red-400 uppercase tracking-wide">
              <AlertTriangle className="w-4 h-4" />
              <span>Overdue Immediate Attention ({overdue.length})</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {overdue.map((item) => (
                <div
                  key={item.assetId}
                  className="p-4 rounded-2xl bg-red-950/15 border border-red-900/50 hover:border-red-700 transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <Link
                        href={`/fleet/${item.code}`}
                        className="font-mono font-bold text-base text-white hover:text-red-300 hover:underline flex items-center gap-1.5"
                      >
                        <span>{item.code}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      </Link>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                        OVERDUE
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 mt-0.5">
                      {item.regNo || item.categoryName} • {item.projectName || "Unassigned"}
                    </div>

                    <div className="mt-3 pt-3 border-t border-red-900/30 text-xs space-y-1">
                      <div className="flex justify-between text-slate-300">
                        <span>Used since service:</span>
                        <span className="font-mono font-bold text-red-400">
                          {item.usedSince?.toLocaleString()} {item.basis}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Interval threshold:</span>
                        <span className="font-mono">{item.intervalValue.toLocaleString()} {item.basis}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Last serviced:</span>
                        <span>{formatDate(item.lastServiceDate)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-red-900/30">
                    <Link
                      href={`/service/record?assetId=${item.assetId}`}
                      className="w-full py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Log Service Now</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Due This Week */}
        {dueThisWeek.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-400 uppercase tracking-wide">
              <Clock className="w-4 h-4" />
              <span>Due This Week (Next 7 Days) ({dueThisWeek.length})</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {dueThisWeek.map((item) => (
                <div
                  key={item.assetId}
                  className="p-4 rounded-2xl bg-amber-950/15 border border-amber-900/50 hover:border-amber-700 transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <Link
                        href={`/fleet/${item.code}`}
                        className="font-mono font-bold text-base text-white hover:text-amber-300 hover:underline flex items-center gap-1.5"
                      >
                        <span>{item.code}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      </Link>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        DUE SOON
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 mt-0.5">
                      {item.regNo || item.categoryName} • {item.projectName || "Unassigned"}
                    </div>

                    <div className="mt-3 pt-3 border-t border-amber-900/30 text-xs space-y-1">
                      <div className="flex justify-between text-slate-300">
                        <span>Remaining buffer:</span>
                        <span className="font-mono font-bold text-amber-400">
                          {item.remaining !== null ? `${item.remaining.toLocaleString()} ${item.basis}` : "Near limit"}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Projected due:</span>
                        <span className="text-slate-200 font-medium">{formatDate(item.projectedDueDate)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Interval:</span>
                        <span className="font-mono">{item.intervalValue.toLocaleString()} {item.basis}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-amber-900/30">
                    <Link
                      href={`/service/record?assetId=${item.assetId}`}
                      className="w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Prepare Service</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Due Later This Month */}
        {dueThisMonth.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-400 uppercase tracking-wide">
              <CalendarIcon className="w-4 h-4" />
              <span>Forecasted Later This Month (8–30 Days) ({dueThisMonth.length})</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {dueThisMonth.map((item) => (
                <div
                  key={item.assetId}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <Link
                      href={`/fleet/${item.code}`}
                      className="font-mono font-bold text-sm text-white hover:text-blue-400 hover:underline flex items-center gap-1.5"
                    >
                      <span>{item.code}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                    </Link>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      ON TRACK
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 mt-0.5">
                    {item.regNo || item.categoryName} • {item.projectName || "Unassigned"}
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs space-y-1">
                    <div className="flex justify-between text-slate-300">
                      <span>Remaining:</span>
                      <span className="font-mono font-medium text-blue-300">
                        {item.remaining?.toLocaleString()} {item.basis}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Forecasted Due Date:</span>
                      <span className="text-slate-200">{formatDate(item.projectedDueDate)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
