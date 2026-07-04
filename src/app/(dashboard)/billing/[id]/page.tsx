import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, Building2, Calendar } from "lucide-react";
import { unitLabel, basisLabel, modeLabel, type BillingMode, type RateBasis } from "@/lib/billing/calc";
import { formatVariancePct } from "@/lib/reports/recommended";
import { getWetRateCents } from "@/lib/billing/rate";
import BillActions from "./BillActions";
import BillingRunningChart from "../components/BillingRunningChart";
import { createCreditNoteAction, issueCreditNoteAction } from "@/app/actions/finance";

interface PageProps {
  params: Promise<{ id: string }>;
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};

export default async function BillDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const { id } = await props.params;

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { lineItems: true },
  });
  if (!bill) notFound();

  // Fetch wet rate for display (even when billing basis is fw or d)
  const assetWithRate = await prisma.asset.findUnique({
    where: { id: bill.assetId },
    include: { rentalRate: true },
  });
  const wetRateCents = assetWithRate?.rentalRate
    ? getWetRateCents(assetWithRate.rentalRate, bill.billingMode as BillingMode)
    : null;

  // USER scope: only their own project's bills.
  if (session.role === "USER" && session.projectId && bill.projectId !== session.projectId) {
    notFound();
  }

  // Load meter readings and fuel issues
  const meterType = bill.billingMode === "perkm" ? "KM" : "HOURS";
  const readings = (bill.billingMode === "hourly" || bill.billingMode === "perkm")
    ? await prisma.meterReading.findMany({
        where: { assetId: bill.assetId, readingType: meterType, readingDate: { gte: bill.periodStart, lte: bill.periodEnd } },
        orderBy: { readingDate: "asc" },
      })
    : [];

  const fuelIssues = await prisma.fuelIssue.findMany({
    where: { assetId: bill.assetId, issueDate: { gte: bill.periodStart, lte: bill.periodEnd } },
    orderBy: { issueDate: "asc" },
  });

  const fuelData = fuelIssues.map((f) => ({
    date: new Date(f.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    litres: f.litres,
  }));

  // Retrieve consumption rates (prefer snapshots stored on the bill, fallback to rate card)
  const fuelConsEcon = bill.fuelConsEconSnapshot ?? assetWithRate?.rentalRate?.fuelConsEcon ?? null;
  const fuelConsTyp = bill.fuelConsTypSnapshot ?? assetWithRate?.rentalRate?.fuelConsTyp ?? null;

  // Build running curves
  let runningFuelLitres = 0;
  const fuelIssuesWithRunning = fuelIssues.map((f) => {
    runningFuelLitres += f.litres;
    return {
      date: f.issueDate,
      dateStr: new Date(f.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      runningStandard: fuelConsTyp && fuelConsTyp > 0 ? (runningFuelLitres / fuelConsTyp) : 0,
      runningEcon: fuelConsEcon && fuelConsEcon > 0 ? (runningFuelLitres / fuelConsEcon) : 0,
    };
  });

  const anchor = bill.openingMeter ?? 0;
  const fuelChartPoints = fuelIssuesWithRunning.map((f) => ({
    date: f.date,
    dateStr: f.dateStr,
    standard: Math.round((anchor + f.runningStandard) * 10) / 10,
    econ: Math.round((anchor + f.runningEcon) * 10) / 10,
  }));

  const meterChartPoints = readings.map((r) => ({
    date: r.readingDate,
    dateStr: new Date(r.readingDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    actual: r.value,
  }));

  // Merge chronologically
  const mergedMap = new Map<string, { date: Date; dateStr: string; actual?: number; standard?: number; econ?: number }>();
  
  for (const p of meterChartPoints) {
    const key = p.date.toISOString().split("T")[0];
    const existingObj = mergedMap.get(key) || { date: p.date, dateStr: p.dateStr };
    existingObj.actual = p.actual;
    mergedMap.set(key, existingObj);
  }
  
  for (const p of fuelChartPoints) {
    const key = p.date.toISOString().split("T")[0];
    const existingObj = mergedMap.get(key) || { date: p.date, dateStr: p.dateStr };
    existingObj.standard = p.standard;
    existingObj.econ = p.econ;
    mergedMap.set(key, existingObj);
  }

  let readingsData = Array.from(mergedMap.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((item) => ({
      date: item.dateStr,
      actual: item.actual ?? null,
      standard: item.standard ?? null,
      econ: item.econ ?? null,
    }));

  if (readingsData.length === 0 && bill.openingMeter != null && bill.closingMeter != null) {
    readingsData = [
      { date: new Date(bill.periodStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), actual: bill.openingMeter, standard: null, econ: null },
      { date: new Date(bill.periodEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), actual: bill.closingMeter, standard: null, econ: null },
    ];
  }

  // Breakdown history for the billing period
  const breakdownConditions = bill.breakdownDays > 0
    ? await prisma.dailyCondition.findMany({
        where: {
          assetId: bill.assetId,
          logDate: { gte: bill.periodStart, lte: bill.periodEnd },
        },
        orderBy: { logDate: "asc" },
        include: { recordedBy: { select: { name: true } } },
      })
    : [];

  // Credit notes against this invoice.
  const creditNotes = await prisma.creditNote.findMany({
    where: { billId: bill.id },
    orderBy: { createdAt: "desc" },
  });
  const issuedCreditCents = creditNotes
    .filter((c) => c.status === "ISSUED")
    .reduce((a, c) => a + c.amountCents, 0);

  const unit = unitLabel(bill.billingMode as BillingMode);
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  // Actual entered meter vs system-recommended (fuel-derived) variance.
  const isMetered = bill.billingMode === "hourly" || bill.billingMode === "perkm";
  const actualMeterVal = bill.actualMeterUnits ?? (bill.derivedFromFuel ? 0 : bill.actualUnits);
  const variancePct =
    isMetered && bill.derivedStandardUnits != null
      ? ((bill.derivedStandardUnits - actualMeterVal) / Math.max(actualMeterVal, 1)) * 100
      : null;

  return (
    <div className="space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> Back to Billing
      </Link>

      {/* Invoice header */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Edward & Christie — Heavy Equipment & Fleet Division</p>
            <h1 className="text-xl font-bold text-white mt-1">
              {bill.invoiceNumber || "DRAFT — not yet issued"}
            </h1>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {bill.projectName || "Unassigned"}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {monthLabel}</span>
            </p>
          </div>
          <div className="text-right">
            <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${STATUS_STYLES[bill.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
              {bill.status}
            </span>
            <div className="text-xs text-gray-400 mt-3 space-y-1">
              <div>Issued: <span className="text-gray-300">{fmtDate(bill.issuedDate)}</span></div>
              <div>Due: <span className="text-gray-300">{fmtDate(bill.dueDate)}</span></div>
              {bill.status === "PAID" && <div>Paid: <span className="text-emerald-400">{fmtDate(bill.paidDate)}</span></div>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/5">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Vehicle</p>
            <p className="text-sm font-bold text-white mt-1">{bill.assetCode}</p>
            <p className="text-xs text-gray-500">{bill.assetLabel}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Billing</p>
            <p className="text-sm font-bold text-white mt-1">{modeLabel(bill.billingMode as BillingMode)}</p>
            <p className="text-xs text-gray-500">{basisLabel(bill.rateBasis as RateBasis)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Grand Total</p>
            <p className="text-lg font-bold text-white mt-1">{rs(bill.grandTotalCents)}</p>
          </div>
          <div className="flex items-end gap-2">
            <a href={`/api/billing/${bill.id}/pdf`} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> PDF
            </a>
            <a href={`/api/billing/${bill.id}/xlsx`} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center justify-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </a>
          </div>
        </div>
      </div>

      {/* Running + fuel charts */}
      <BillingRunningChart mode={bill.billingMode} unit={unit} readingsData={readingsData} fuelData={fuelData} derived={bill.derivedFromFuel} />

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rental / usage breakdown */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Rental & Usage</h3>
          <dl className="space-y-2.5 text-xs">
            {/* Standard comparison lines if hourly or perkm mode */}
            {(bill.billingMode === "hourly" || bill.billingMode === "perkm") ? (
              <>
                <Row
                  label={`Actual ${unit} (meter-derived)`}
                  value={bill.actualMeterUnits != null 
                    ? bill.actualMeterUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })
                    : (bill.derivedFromFuel ? "0.00" : bill.actualUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 }))
                  }
                  active={!bill.derivedFromFuel}
                />
                <Row
                  label={`Actual standard ${unit} (fuel-derived)`}
                  value={bill.derivedStandardUnits != null 
                    ? bill.derivedStandardUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })
                    : "—"
                  }
                  active={bill.derivedFromFuel && bill.derivedStandardUnits != null && Math.abs(bill.actualUnits - bill.derivedStandardUnits) < 0.1}
                />
                <Row
                  label={`Actual economy ${unit} (fuel-derived)`}
                  value={bill.derivedEconUnits != null
                    ? bill.derivedEconUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })
                    : "—"
                  }
                  active={bill.derivedFromFuel && bill.derivedEconUnits != null && Math.abs(bill.actualUnits - bill.derivedEconUnits) < 0.1}
                />
                {variancePct != null && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-400">Meter vs recommended variance</dt>
                    <dd className={`font-bold ${Math.abs(variancePct) >= 20 ? (variancePct > 0 ? "text-red-400" : "text-amber-400") : "text-gray-300"}`}>
                      {formatVariancePct(variancePct / 100)}
                      {Math.abs(variancePct) >= 20 ? (variancePct > 0 ? " · meter low" : " · meter high") : ""}
                    </dd>
                  </div>
                )}
              </>
            ) : (
              <Row
                label={`Actual ${unit}`}
                value={bill.actualUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })}
              />
            )}
            <Row label={`Minimum guaranteed ${unit}`} value={bill.minimumUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })} />
            <Row label={`Billable ${unit}`} value={bill.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })} strong />
            {bill.openingMeter != null && (
              <Row label="Opening → Closing meter" value={`${bill.openingMeter.toLocaleString()} → ${bill.closingMeter?.toLocaleString() ?? "—"}`} />
            )}
            {bill.breakdownDays > 0 && (
              <Row label="Breakdown days" value={`${bill.breakdownDays} day${bill.breakdownDays !== 1 ? "s" : ""}`} />
            )}
            {wetRateCents != null && bill.rateBasis !== "w" && (
              <Row label={`Wet rate (per ${unit})`} value={rs(wetRateCents)} />
            )}
            <Row label={`${bill.rateBasis === "w" ? "Wet" : bill.rateBasis === "fw" ? "Fully Wet" : "Dry"} rate (per ${unit})`} value={rs(bill.rateCents)} strong />
            <div className="border-t border-white/5 my-2" />
            <Row label="Rental amount" value={rs(bill.rentalAmountCents)} strong />
            {bill.breakdownDeductCents > 0 && (
              <Row label="Breakdown deduction" value={`− ${rs(bill.breakdownDeductCents)}`} />
            )}
            <Row label={`Fuel — monthly total, all sites (${bill.fuelLitres.toLocaleString("en-LK", { maximumFractionDigits: 1 })} L)`} value={(bill.rateBasis === "fw" || bill.rateBasis === "w") && bill.fuelCostCents > 0 ? rs(bill.fuelCostCents) : `Not billed (${basisLabel(bill.rateBasis as RateBasis)})`} />
          </dl>
        </div>

        {/* Tax breakdown */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Invoice Totals</h3>
          <dl className="space-y-2.5 text-xs">
            <Row label="Subtotal" value={rs(bill.subtotalCents)} />
            <Row label={`SSCL (${(bill.ssclRate * 100).toFixed(1)}%)`} value={rs(bill.ssclCents)} />
            <Row label="Pre-VAT" value={rs(bill.subtotalCents + bill.ssclCents)} />
            <Row label={`VAT (${(bill.vatRate * 100).toFixed(1)}%)`} value={rs(bill.vatCents)} />
            <div className="border-t border-white/5 my-2" />
            <Row label="Grand Total" value={rs(bill.grandTotalCents)} strong />
          </dl>
        </div>
      </div>

      {/* Line items */}
      <div className="border border-white/5 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              <th className="px-4 py-3">Charge</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit Rate</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bill.lineItems.map((li) => (
              <tr key={li.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-semibold text-white">{li.kind}</td>
                <td className="px-4 py-3 text-gray-400">{li.description}</td>
                <td className="px-4 py-3 text-right text-gray-300">{li.quantity.toLocaleString("en-LK", { maximumFractionDigits: 2 })} {li.unit}</td>
                <td className="px-4 py-3 text-right text-gray-300">{rs(li.unitRateCents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-white">{rs(li.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bill.derivedFromFuel && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-4 text-xs text-amber-300 flex items-start gap-3">
          <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px] shrink-0 mt-0.5">Notice</span>
          <p>
            Actual {unit} derived from fuel consumption rate ({bill.fuelConsMidRate != null ? bill.fuelConsMidRate.toFixed(2) : "—"} L/{unit === "km" ? "km" : "hr"}) — fuel-derived units were higher than recorded actual units and were billed to maximize revenue.
          </p>
        </div>
      )}

      {bill.notes && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 text-xs text-gray-400">
          <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Notes</span>
          <p className="mt-2">{bill.notes}</p>
        </div>
      )}

      {/* Breakdown history */}
      {bill.breakdownDays > 0 && (
        <div className="bg-[#121420] border border-red-500/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Breakdown History</h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-400">{bill.breakdownDays} breakdown day{bill.breakdownDays !== 1 ? "s" : ""} in period</span>
              {bill.breakdownDeductCents > 0 && (
                <span className="text-red-400 font-bold">Deduction: {rs(bill.breakdownDeductCents)}</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {breakdownConditions.map((c) => (
              <div key={c.id} className={`flex items-center gap-3 text-xs px-3 py-2 rounded-xl ${c.status === "BREAKDOWN" ? "bg-red-500/5 border border-red-500/10" : "bg-emerald-500/5 border border-emerald-500/10"}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === "BREAKDOWN" ? "bg-red-500" : "bg-emerald-500"}`} />
                <span className="text-gray-300 font-mono w-24 shrink-0">{new Date(c.logDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                <span className={`font-semibold w-20 shrink-0 ${c.status === "BREAKDOWN" ? "text-red-400" : "text-emerald-400"}`}>{c.status}</span>
                <span className="text-gray-500">{c.note || "—"}</span>
                <span className="ml-auto text-gray-600 shrink-0">{c.recordedBy.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credit notes (issued/overdue/paid invoices only) */}
      {bill.status !== "DRAFT" && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Credit Notes</h3>
            {issuedCreditCents > 0 && (
              <span className="text-xs text-amber-300 font-semibold">Net outstanding: {rs(bill.grandTotalCents - issuedCreditCents)}</span>
            )}
          </div>
          {creditNotes.length === 0 ? (
            <p className="text-xs text-gray-500">No credit notes raised.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {creditNotes.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs bg-white/5 rounded-xl px-3 py-2.5">
                  <div>
                    <span className="font-bold text-white">{c.number || "DRAFT"}</span>
                    <span className="text-gray-400 ml-2">{c.reason}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-white">− {rs(c.amountCents)}</span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${c.status === "ISSUED" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{c.status}</span>
                    {isAdmin && c.status === "DRAFT" && (
                      <form action={async () => { "use server"; await issueCreditNoteAction(c.id); }}>
                        <button type="submit" className="text-indigo-400 hover:text-indigo-300 font-semibold underline text-[10px]">Issue</button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {isAdmin && (
            <form action={async (fd) => { "use server"; await createCreditNoteAction(fd); }} className="flex flex-wrap items-end gap-2 border-t border-white/5 pt-4">
              <input type="hidden" name="billId" value={bill.id} />
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Amount (LKR)</label>
                <input name="amount" type="number" step="0.01" min="0" required className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-32" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Reason</label>
                <input name="reason" type="text" required placeholder="e.g. billing correction, goodwill" className="w-full bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
              </div>
              <button type="submit" className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg px-4 py-2">Add credit note</button>
            </form>
          )}
        </div>
      )}

      {/* Admin actions */}
      {isAdmin && <BillActions bill={{
        id: bill.id,
        status: bill.status,
        billingMode: bill.billingMode,
        rateBasis: bill.rateBasis,
        minimumUnits: bill.minimumUnits,
        notes: bill.notes,
        grandTotalCents: bill.grandTotalCents,
      }} />}
    </div>
  );
}

function Row({ label, value, strong, active }: { label: string; value: string; strong?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={active ? "text-indigo-400 font-bold" : "text-gray-400"}>{label}</dt>
      <dd className={strong ? "text-white font-bold" : active ? "text-indigo-400 font-bold" : "text-gray-300"}>{value}</dd>
    </div>
  );
}
