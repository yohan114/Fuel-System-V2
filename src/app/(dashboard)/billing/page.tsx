import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { currentMonthPeriod } from "@/lib/billing/period";
import { VARIANCE_THRESHOLD, formatVariancePct } from "@/lib/reports/recommended";
import { Receipt, Wallet, FileText, AlertTriangle, Gauge } from "lucide-react";
import Link from "next/link";
import GenerateBillsPanel from "./components/GenerateBillsPanel";
import ConsolidatedBillPanel from "./components/ConsolidatedBillPanel";
import BillsTable from "./components/BillsTable";
import AgingReport from "./components/AgingReport";

interface PageProps {
  searchParams: Promise<{ month?: string; site?: string; status?: string; check?: string }>;
}

// Fuel-implied units vs the running-chart units, from the bill's snapshots
// (e.g. 500 L at 5 L/hr implies 100 h; a 75 h chart is +33% — clarify with the
// site before finalizing). Null when the bill isn't metered or has no fuel
// derivation to compare against.
function meterVsFuelVariance(b: {
  billingMode: string;
  derivedStandardUnits: number | null;
  actualMeterUnits: number | null;
  actualUnits: number;
  derivedFromFuel: boolean;
}): number | null {
  const metered = b.billingMode === "hourly" || b.billingMode === "perkm";
  if (!metered || b.derivedStandardUnits == null) return null;
  const actual = b.actualMeterUnits ?? (b.derivedFromFuel ? 0 : b.actualUnits);
  return (b.derivedStandardUnits - actual) / Math.max(actual, 1);
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function BillingPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const searchParams = await props.searchParams;

  const cur = currentMonthPeriod();
  const periodKey = searchParams.month || cur.periodKey;
  const statusFilter = searchParams.status || "all";
  const siteFilter = searchParams.site || "all";

  const projects = await prisma.project.findMany({ orderBy: { name: "asc" } });

  // Build the where clause. USER role is locked to its own project.
  const where: any = { periodKey };
  if (session.role === "USER" && session.projectId) {
    where.projectId = session.projectId;
  } else if (siteFilter === "unassigned") {
    where.projectId = null;
  } else if (siteFilter !== "all") {
    where.projectId = siteFilter;
  }
  if (statusFilter !== "all") where.status = statusFilter;

  const allBills = await prisma.bill.findMany({
    where,
    orderBy: [{ grandTotalCents: "desc" }],
  });

  // Meter-vs-fuel check across the (unfiltered) month for the tile count.
  const needsClarify = (v: number | null) => v != null && Math.abs(v) >= VARIANCE_THRESHOLD;
  const clarifyCount = allBills.filter((b) => needsClarify(meterVsFuelVariance(b))).length;
  const checkFilter = searchParams.check === "clarify";
  const bills = checkFilter ? allBills.filter((b) => needsClarify(meterVsFuelVariance(b))) : allBills;

  const totalGrand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  const totalRental = bills.reduce((s, b) => s + b.rentalAmountCents, 0);
  const totalFuel = bills.reduce((s, b) => s + b.fuelCostCents, 0);
  const overdueCount = bills.filter((b) => b.status === "OVERDUE").length;

  const [y, m] = periodKey.split("-").map(Number);
  const monthLabel = new Date(y, (m || 1) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-400" />
            Monthly Billing
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Per-vehicle rental + fuel statements & invoices for {monthLabel}.
          </p>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Billing Month</label>
          <input
            type="month"
            name="month"
            defaultValue={periodKey}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        {session.role !== "USER" && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Site</label>
            <select
              name="site"
              defaultValue={siteFilter}
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            >
              <option value="all">All sites</option>
              <option value="unassigned">Unassigned / Global Pool</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</label>
          <select
            name="status"
            defaultValue={statusFilter}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            <option value="all">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ISSUED">Issued</option>
            <option value="PAID">Paid</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Meter check</label>
          <select
            name="check"
            defaultValue={checkFilter ? "clarify" : "all"}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            <option value="all">All bills</option>
            <option value="clarify">Needs clarification (±{VARIANCE_THRESHOLD * 100}%+)</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all"
        >
          Apply Filters
        </button>
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><FileText className="w-3.5 h-3.5" /> Bills</div>
          <div className="text-lg font-bold text-white mt-1">{bills.length}</div>
        </div>
        <Link
          href={`/billing?month=${periodKey}${siteFilter !== "all" ? `&site=${siteFilter}` : ""}&check=clarify`}
          className={`bg-[#121420] border p-4 rounded-2xl transition-colors ${checkFilter ? "border-amber-500/40" : "border-white/5 hover:border-amber-500/30"}`}
          title="Fuel-implied hours/km differ from the running chart by 20% or more — clarify these vehicles with the site"
        >
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><Gauge className="w-3.5 h-3.5" /> Meter vs fuel — clarify</div>
          <div className={`text-lg font-bold mt-1 ${clarifyCount ? "text-amber-400" : "text-white"}`}>{clarifyCount}</div>
        </Link>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><Wallet className="w-3.5 h-3.5" /> Grand Total</div>
          <div className="text-lg font-bold text-white mt-1">{rs(totalGrand)}</div>
        </div>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Rental / Fuel</div>
          <div className="text-sm font-bold text-white mt-1">{rs(totalRental)} <span className="text-gray-500">/</span> {rs(totalFuel)}</div>
        </div>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><AlertTriangle className="w-3.5 h-3.5" /> Overdue</div>
          <div className={`text-lg font-bold mt-1 ${overdueCount ? "text-red-400" : "text-white"}`}>{overdueCount}</div>
        </div>
      </div>

      {/* Receivables aging (all unpaid invoices, across months) */}
      <AgingReport projectId={session.role === "USER" ? session.projectId : null} />

      {/* Admin generate panels */}
      {isAdmin && <GenerateBillsPanel defaultYear={y || cur.year} defaultMonth={m || cur.month} />}
      {isAdmin && (
        <ConsolidatedBillPanel
          defaultYear={y || cur.year}
          defaultMonth={m || cur.month}
          sites={projects.map((p) => ({ code: p.code, name: p.name }))}
        />
      )}

      {/* Bills table */}
      {bills.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-500 bg-[#121420] border border-white/5 rounded-2xl">
          No bills for {monthLabel}.{isAdmin ? " Use Generate Monthly Bills above." : ""}
        </div>
      ) : (
        <BillsTable
          isAdmin={isAdmin}
          bills={bills.map((b) => {
            const v = meterVsFuelVariance(b);
            return {
              id: b.id,
              assetCode: b.assetCode,
              assetLabel: b.assetLabel,
              projectName: b.projectName,
              billingMode: b.billingMode,
              rateBasis: b.rateBasis,
              billableUnits: b.billableUnits,
              rentalAmountCents: b.rentalAmountCents,
              fuelCostCents: b.fuelCostCents,
              grandTotalCents: b.grandTotalCents,
              status: b.status,
              meterCheck: needsClarify(v) ? formatVariancePct(v) : null,
            };
          })}
        />
      )}
    </div>
  );
}
