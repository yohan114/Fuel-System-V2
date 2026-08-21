import React from "react";
import Link from "next/link";
import { Building2, ExternalLink, Truck } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};
const MODE_LABEL: Record<string, string> = { hourly: "Hourly", perkm: "Per-KM", perday: "Per-Day" };

const rs = (c: number) => "Rs. " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: number, d = 1) => v.toLocaleString("en-LK", { maximumFractionDigits: d });

export interface SiteCostRow {
  projectKey: string;
  projectName: string;
  days: number;
  billableUnits: number;
  rentalCents: number;
  fuelCents: number;
  totalCents: number;
  /** This site's share of the grand total, tax apportioned by value. */
  payableCents: number;
}

export interface MonthChip {
  periodKey: string;
  label: string;
  grandTotalCents: number;
  isCurrent: boolean;
  href: string;
}

export interface VehicleBillView {
  billId: string;
  assetCode: string;
  assetRegNo: string | null;
  assetLabel: string | null;
  projectName: string | null;
  status: string;
  billingMode: string;
  rateBasis: string;
  unit: string;
  billableUnits: number;
  minimumUnits: number;
  rentalAmountCents: number;
  fuelCostCents: number;
  fuelLitres: number;
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
  monthLabel: string;
  /** Null when the vehicle worked a single site — there is nothing to split. */
  siteCosts: SiteCostRow[] | null;
  totalDays: number;
  months: MonthChip[];
}

/**
 * One vehicle's bill for the selected month, with the cost each site carries.
 *
 * The site rows come from the bill's own line items, so this cannot drift from
 * what was invoiced. "Payable" is the site's share of the grand total with SSCL
 * and VAT apportioned by value — the same figures the invoice PDF prints — and
 * the rows sum to the grand total exactly.
 */
export default function VehicleBillPanel({ v }: { v: VehicleBillView }) {
  const basisLabel = v.rateBasis === "d" ? "Dry" : v.rateBasis === "fw" ? "Fully Wet" : "Wet";
  const atMinimum = v.billableUnits <= v.minimumUnits;

  return (
    <div className="bg-[#121420] border border-indigo-500/20 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Truck className="w-4 h-4 text-indigo-400 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-bold text-white">{v.assetCode}</span>
            {/* 174 of 717 bills carry the E&C code in the registration field, so
                showing both verbatim reads "AC-01 AC-01". */}
            {v.assetRegNo && v.assetRegNo !== v.assetCode && (
              <span className="text-xs text-gray-400">{v.assetRegNo}</span>
            )}
            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${STATUS_STYLES[v.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
              {v.status}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {v.assetLabel || "—"} · {v.projectName || "Unassigned"} · {MODE_LABEL[v.billingMode] || v.billingMode} · {basisLabel} · {v.monthLabel}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Grand total</div>
          <div className="text-lg font-bold text-amber-400">{rs(v.grandTotalCents)}</div>
        </div>
        <Link
          href={`/billing/${v.billId}`}
          className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all shrink-0"
        >
          View full bill <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-white/5 border-b border-white/5">
        {[
          { label: `Billed (${v.unit})`, value: num(v.billableUnits), note: atMinimum ? `at the ${num(v.minimumUnits, 0)} minimum` : "above the minimum" },
          { label: "Rental", value: rs(v.rentalAmountCents), note: null },
          { label: "Fuel", value: v.fuelCostCents > 0 ? rs(v.fuelCostCents) : "—", note: v.fuelLitres > 0 ? `${num(v.fuelLitres, 0)} L` : "not charged" },
          { label: "SSCL + VAT", value: rs(v.ssclCents + v.vatCents), note: null },
          { label: "Days on site", value: v.totalDays > 0 ? String(v.totalDays) : "—", note: null },
        ].map((c) => (
          <div key={c.label} className="px-4 py-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{c.label}</div>
            <div className="text-sm font-bold text-white mt-1">{c.value}</div>
            {c.note && <div className="text-[10px] text-gray-500 mt-0.5">{c.note}</div>}
          </div>
        ))}
      </div>

      {/* Site cost — what each site carries of this one bill. */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-bold text-white">Site cost</span>
        </div>
        {v.siteCosts ? (
          <>
            <p className="text-[11px] text-gray-500 mb-3">
              Worked {v.siteCosts.length} sites over {v.totalDays} allocated days. Each site is charged for the days it had the
              machine; the tax follows the charge, so the payable column adds up to the grand total.
            </p>
            <div className="border border-white/5 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
                    <th className="px-3 py-2">Site</th>
                    <th className="px-3 py-2 text-right">Days</th>
                    <th className="px-3 py-2 text-right">Billed ({v.unit})</th>
                    <th className="px-3 py-2 text-right">Rental</th>
                    <th className="px-3 py-2 text-right">Fuel</th>
                    <th className="px-3 py-2 text-right">Site total</th>
                    <th className="px-3 py-2 text-right">Payable incl. tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {v.siteCosts.map((r) => (
                    <tr key={r.projectKey} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-semibold text-white">{r.projectName}</td>
                      <td className="px-3 py-2 text-right text-gray-300 font-mono">{r.days || "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-300 font-mono">{num(r.billableUnits)}</td>
                      <td className="px-3 py-2 text-right text-gray-300 font-mono">{rs(r.rentalCents)}</td>
                      <td className="px-3 py-2 text-right text-amber-500/80 font-mono">{r.fuelCents > 0 ? rs(r.fuelCents) : "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-200 font-mono">{rs(r.totalCents)}</td>
                      <td className="px-3 py-2 text-right text-white font-mono font-bold">{rs(r.payableCents)}</td>
                    </tr>
                  ))}
                  <tr className="bg-white/[0.03] border-t border-white/10">
                    <td className="px-3 py-2 font-bold text-white">ALL SITES</td>
                    <td className="px-3 py-2 text-right text-gray-300 font-mono">{v.totalDays}</td>
                    <td className="px-3 py-2 text-right text-gray-200 font-mono">{num(v.billableUnits)}</td>
                    <td className="px-3 py-2 text-right text-gray-200 font-mono">{rs(v.rentalAmountCents)}</td>
                    <td className="px-3 py-2 text-right text-gray-200 font-mono">{rs(v.fuelCostCents)}</td>
                    <td className="px-3 py-2 text-right text-gray-200 font-mono">{rs(v.subtotalCents)}</td>
                    <td className="px-3 py-2 text-right text-amber-400 font-mono font-bold">{rs(v.grandTotalCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-gray-400">
            Worked one site this month — <span className="text-white font-semibold">{v.projectName || "Unassigned"}</span> carries the
            whole {rs(v.grandTotalCents)}. There is nothing to split.
          </p>
        )}
      </div>

      {/* Every month this vehicle was billed, so one search shows its whole year. */}
      {v.months.length > 1 && (
        <div className="px-5 py-3 border-t border-white/5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mr-1">Other months</span>
          {v.months.map((m) => (
            <Link
              key={m.periodKey}
              href={m.href}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                m.isCurrent
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/20"
                  : "bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white"
              }`}
            >
              {m.label} <span className="font-mono ml-1">{rs(m.grandTotalCents)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
