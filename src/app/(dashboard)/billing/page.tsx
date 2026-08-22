import { isSiteUser, billingScope } from "@/lib/roles";
import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { currentMonthPeriod } from "@/lib/billing/period";
import { VARIANCE_THRESHOLD, formatVariancePct } from "@/lib/reports/recommended";
import { Receipt, Wallet, FileText, AlertTriangle, Gauge } from "lucide-react";
import Link from "next/link";
import GenerateBillsPanel from "./components/GenerateBillsPanel";
import ReadinessReport from "./components/ReadinessReport";
import ConsolidatedBillPanel from "./components/ConsolidatedBillPanel";
import BillsTable from "./components/BillsTable";
import AgingReport from "./components/AgingReport";
import VehicleBillPanel, { type VehicleBillView } from "./components/VehicleBillPanel";
import { matchesVehicle } from "@/lib/vehicle-search";
import { computeSiteSplit, type SplitLineItem } from "@/lib/billing/site-split";
import { apportionCents } from "@/lib/billing/site-explode";
import { buildSiteRoster } from "@/lib/billing/site-roster";
import SiteBillingAdvanced from "./components/SiteBillingAdvanced";

interface PageProps {
  searchParams: Promise<{ month?: string; site?: string; status?: string; check?: string; q?: string }>;
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

  // Who may see what. Resolved from an allow-list, not by exclusion: a role that
  // is not explicitly granted company-wide billing and is not a site user with a
  // site set sees nothing at all. WORKSHOP falls here — issuing fuel for any
  // vehicle does not entitle it to read every site's invoices.
  const scope = billingScope(session);
  if (scope.kind === "none") {
    return (
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-8 text-center">
        <p className="text-sm text-white font-semibold">Billing is not available for this login.</p>
        <p className="text-xs text-gray-400 mt-2">
          Invoices are visible to administrators, and to a site login for its own site only.
        </p>
      </div>
    );
  }

  // A bill is ADDRESSED to whichever site held the machine longest, but the work
  // belongs to every site it touched. Filtering on projectId alone therefore
  // answered the wrong question and answered it invisibly: Kotugoda had HEX-46
  // for four days in July, Rs 131,087 of it, and picking Kotugoda showed an
  // empty page — the bill is addressed to the site that had the other 27 days.
  //
  // So a site filter selects bills whose SPLIT touches the site, the same rule
  // the consolidated PDFs use, and the figures shown are that site's portion
  // rather than the whole invoice. Showing Kotugoda HEX-46's full Rs 10.8M would
  // be worse than showing nothing.
  const activeSite = scope.kind === "project" ? scope.projectId : siteFilter;
  const bySplit = activeSite !== "all" && activeSite !== "unassigned";

  const where: any = { periodKey };
  if (activeSite === "unassigned") where.projectId = null;
  if (statusFilter !== "all") where.status = statusFilter;

  // The split needs line items. Loading them for a whole month is only worth it
  // when a site is actually selected; the all-sites list shows no line detail.
  const rawBills = await prisma.bill.findMany({
    where,
    orderBy: [{ grandTotalCents: "desc" }],
    ...(bySplit ? { include: { lineItems: true } } : {}),
  });

  // Each bill reduced to this site's share, or left whole when no site is on.
  type Portion = { days: number; totalDays: number; fullGrandCents: number } | null;
  const allBills: ((typeof rawBills)[number] & { portion?: Portion })[] = bySplit
    ? rawBills
        .map((b) => {
          const items = (b as { lineItems?: SplitLineItem[] }).lineItems ?? [];
          const split = computeSiteSplit(items, b.minimumUnits);
          // Single-site bills carry no split; they belong wholly to the site the
          // invoice names.
          if (!split) return b.projectId === activeSite ? { ...b, portion: null } : null;
          const idx = split.rows.findIndex((r) => r.projectKey === activeSite);
          if (idx < 0) return null;
          // Tax follows the value it was charged on, residual to the largest
          // share, so the site rows add back to the invoice exactly.
          const weights = split.rows.map((r) => r.totalCents);
          const grand = apportionCents(b.grandTotalCents, weights);
          const rental = apportionCents(b.rentalAmountCents, weights);
          const fuelCost = apportionCents(b.fuelCostCents, weights);
          const row = split.rows[idx];
          return {
            ...b,
            grandTotalCents: grand[idx],
            rentalAmountCents: rental[idx],
            fuelCostCents: fuelCost[idx],
            billableUnits: row.billableUnits,
            portion: { days: row.days, totalDays: split.totalDays, fullGrandCents: b.grandTotalCents },
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .sort((a, b) => b.grandTotalCents - a.grandTotalCents)
    : rawBills;

  // What is on this site's bill and what arguably should be. Only when a site is
  // actually chosen — the question has no meaning across the whole estate.
  const roster = bySplit ? await buildSiteRoster(activeSite, periodKey) : null;

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

  // ── single-vehicle view ────────────────────────────────────────────────────
  // When a search narrows the month to exactly one vehicle, show what that bill
  // costs each site. The split needs the bill's line items, which the list query
  // deliberately does not load — fetching them for two hundred bills to render a
  // table that shows none of them would be wasteful. So it is loaded only here,
  // for the one bill in question.
  const search = (searchParams.q || "").trim();
  const keepFilters = (q: string) => {
    const p = new URLSearchParams();
    p.set("month", periodKey);
    if (siteFilter !== "all") p.set("site", siteFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (checkFilter) p.set("check", "clarify");
    if (q) p.set("q", q);
    return `/billing?${p.toString()}`;
  };

  let vehicleView: VehicleBillView | null = null;
  if (search) {
    const hits = bills.filter((b) =>
      matchesVehicle({ code: b.assetCode, regNo: b.assetRegNo, label: b.assetLabel }, search)
    );
    if (hits.length === 1) {
      const hit = hits[0];
      const [full, others] = await Promise.all([
        prisma.bill.findUnique({ where: { id: hit.id }, include: { lineItems: true } }),
        prisma.bill.findMany({
          where: { assetId: hit.assetId },
          select: { periodKey: true, year: true, month: true, grandTotalCents: true },
          orderBy: { periodKey: "asc" },
        }),
      ]);
      if (full) {
        const split = computeSiteSplit(full.lineItems, full.minimumUnits);
        // Tax follows the value it was charged on, and the residual goes to the
        // largest share, so the site rows add back to the grand total exactly.
        const payable = split
          ? apportionCents(full.grandTotalCents, split.rows.map((r) => r.totalCents))
          : [];
        vehicleView = {
          billId: full.id,
          assetCode: full.assetCode,
          assetRegNo: full.assetRegNo,
          assetLabel: full.assetLabel,
          projectName: full.projectName,
          status: full.status,
          billingMode: full.billingMode,
          rateBasis: full.rateBasis,
          unit: full.billingMode === "perkm" ? "km" : full.billingMode === "perday" ? "days" : "hr",
          billableUnits: full.billableUnits,
          minimumUnits: full.minimumUnits,
          rateCents: full.rateCents,
          rentalAmountCents: full.rentalAmountCents,
          fuelCostCents: full.fuelCostCents,
          fuelLitres: full.fuelLitres || 0,
          subtotalCents: full.subtotalCents,
          ssclCents: full.ssclCents,
          vatCents: full.vatCents,
          grandTotalCents: full.grandTotalCents,
          monthLabel,
          totalDays: split?.totalDays ?? 0,
          siteCosts:
            split && split.rows.length > 1
              ? split.rows.map((r, i) => ({
                  projectKey: r.projectKey,
                  projectName: r.projectName,
                  days: r.days,
                  billableUnits: r.billableUnits,
                  rentalCents: r.rentalCents,
                  fuelCents: r.fuelCents,
                  totalCents: r.totalCents,
                  payableCents: payable[i],
                }))
              : null,
          months: others.map((o) => ({
            periodKey: o.periodKey,
            label: new Date(o.year, o.month - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" }),
            grandTotalCents: o.grandTotalCents,
            isCurrent: o.periodKey === periodKey,
            href: `/billing?month=${o.periodKey}&q=${encodeURIComponent(search)}`,
          })),
        };
      }
    }
  }

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
        {/* Changing the month must not throw away the vehicle you were looking at. */}
        {search && <input type="hidden" name="q" value={search} />}
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Billing Month</label>
          <input
            type="month"
            name="month"
            defaultValue={periodKey}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        {scope.kind === "all" && (
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
          href={`/billing?month=${periodKey}${siteFilter !== "all" ? `&site=${siteFilter}` : ""}&check=clarify${search ? `&q=${encodeURIComponent(search)}` : ""}`}
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
      <AgingReport projectId={scope.kind === "project" ? scope.projectId : null} />

      {/* Admin generate panels */}
      {isAdmin && <ReadinessReport year={y || cur.year} month={m || cur.month} />}
      {isAdmin && <GenerateBillsPanel defaultYear={y || cur.year} defaultMonth={m || cur.month} />}
      {isAdmin && (
        <ConsolidatedBillPanel
          defaultYear={y || cur.year}
          defaultMonth={m || cur.month}
          sites={projects.map((p) => ({ code: p.code, name: p.name }))}
        />
      )}

      {/* Add and remove vehicles on one site's bill. Needs a site chosen: the
          panel is about one site's month, and "all sites" is not one. */}
      {isAdmin && roster && <SiteBillingAdvanced roster={roster} />}

      {/* One vehicle, and what it costs each site it worked */}
      {vehicleView && <VehicleBillPanel v={vehicleView} />}

      {/* Bills table */}
      {bills.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-500 bg-[#121420] border border-white/5 rounded-2xl">
          No bills for {monthLabel}.{isAdmin ? " Use Generate Monthly Bills above." : ""}
        </div>
      ) : (
        <BillsTable
          isAdmin={isAdmin}
          initialSearch={search}
          searchBaseHref={keepFilters("")}
          bills={bills.map((b) => {
            const v = meterVsFuelVariance(b);
            return {
              id: b.id,
              assetCode: b.assetCode,
              assetRegNo: b.assetRegNo,
              assetLabel: b.assetLabel,
              projectName: b.projectName,
              billingMode: b.billingMode,
              rateBasis: b.rateBasis,
              billableUnits: b.billableUnits,
              rateCents: b.rateCents,
              rentalAmountCents: b.rentalAmountCents,
              fuelCostCents: b.fuelCostCents,
              grandTotalCents: b.grandTotalCents,
              status: b.status,
              meterCheck: needsClarify(v) ? formatVariancePct(v) : null,
              portion: b.portion ?? null,
            };
          })}
        />
      )}
    </div>
  );
}
