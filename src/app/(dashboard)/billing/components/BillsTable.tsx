"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Banknote, Loader2, Search, X } from "lucide-react";
import { bulkFinalizeBillsAction, bulkMarkPaidAction, bulkSetBillBasisAction } from "@/app/actions/billing";
import { matchesVehicle, looksLikePlate } from "@/lib/vehicle-search";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};
const MODE_LABEL: Record<string, string> = { hourly: "Hourly", perkm: "Per-KM", perday: "Per-Day" };

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export interface BillRow {
  id: string;
  assetCode: string;
  assetRegNo: string | null;
  assetLabel: string | null;
  projectName: string | null;
  billingMode: string;
  rateBasis: string;
  billableUnits: number;
  /** The rate the bill was priced at, per hour/km/day. */
  rateCents: number;
  rentalAmountCents: number;
  fuelCostCents: number;
  grandTotalCents: number;
  status: string;
  meterCheck: string | null; // formatted variance when fuel-implied units differ ≥20% from the chart
}

export default function BillsTable({
  bills,
  isAdmin,
  initialSearch = "",
  searchBaseHref = "/billing",
}: {
  bills: BillRow[];
  isAdmin: boolean;
  /** Seeds the box from ?q= so a shared link opens with its search applied. */
  initialSearch?: string;
  /**
   * The page URL carrying the other filters, already query-stringed. Submitting
   * appends `q` to it. A string rather than a callback because a server
   * component cannot hand a function to a client one.
   */
  searchBaseHref?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState(initialSearch);

  // Narrowing happens here rather than in the query: the month is already loaded,
  // and matching "hex37" against "HEX-37" is a job for JavaScript, not SQL LIKE.
  const visible = useMemo(
    () => (search.trim() ? bills.filter((b) => matchesVehicle({ code: b.assetCode, regNo: b.assetRegNo, label: b.assetLabel }, search)) : bills),
    [bills, search]
  );

  // Submitting puts the query in the URL, which is what makes the server render
  // the single-vehicle panel with its site-cost breakdown.
  function hrefFor(q: string) {
    const sep = searchBaseHref.includes("?") ? "&" : "?";
    return q ? `${searchBaseHref}${sep}q=${encodeURIComponent(q)}` : searchBaseHref;
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(hrefFor(search.trim()));
  }
  function clearSearch() {
    setSearch("");
    router.push(hrefFor(""));
  }

  const draftIds = useMemo(() => bills.filter((b) => b.status === "DRAFT").map((b) => b.id), [bills]);
  const payableIds = useMemo(
    () => bills.filter((b) => b.status === "ISSUED" || b.status === "OVERDUE").map((b) => b.id),
    [bills]
  );

  const selectedArr = Array.from(selected);
  const selectedDrafts = selectedArr.filter((id) => draftIds.includes(id));
  const selectedPayable = selectedArr.filter((id) => payableIds.includes(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Select-all means the rows in front of you, not the ones a search is hiding —
  // otherwise "finalize selected" would quietly issue invoices you cannot see.
  function toggleAll() {
    setSelected((prev) => {
      const allVisible = visible.length > 0 && visible.every((b) => prev.has(b.id));
      if (allVisible) {
        const next = new Set(prev);
        for (const b of visible) next.delete(b.id);
        return next;
      }
      return new Set([...prev, ...visible.map((b) => b.id)]);
    });
  }

  function runFinalize() {
    if (selectedDrafts.length === 0) return;
    if (!confirm(`Finalize & issue ${selectedDrafts.length} draft invoice(s)? They will be locked.`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkFinalizeBillsAction(selectedDrafts);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({
          ok: true,
          text: `Finalized ${res.finalized}${res.needsClarify ? `, ${res.needsClarify} left for clarification (open them to review)` : ""}${res.skipped ? `, skipped ${res.skipped}` : ""}${res.errors?.length ? `, ${res.errors.length} errors` : ""}.`,
        });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function runSetBasis(basis: string) {
    if (selectedDrafts.length === 0 || !basis) return;
    const label = basis === "d" ? "Dry (rental only, no fuel)" : basis === "fw" ? "Fully Wet" : "Wet";
    if (!confirm(`Re-cost ${selectedDrafts.length} draft(s) as ${label}? Rental re-rates and fuel is ${basis === "d" ? "removed" : "included"}.`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkSetBillBasisAction(selectedDrafts, basis);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `Re-costed ${res.updated} draft(s) as ${label}${res.skipped ? `, skipped ${res.skipped}` : ""}.` });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function runMarkPaid() {
    if (selectedPayable.length === 0) return;
    if (!confirm(`Mark ${selectedPayable.length} invoice(s) as fully paid (today)?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkMarkPaidAction(selectedPayable);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `Marked ${res.paid} paid, skipped ${res.skipped}${res.errors?.length ? `, ${res.errors.length} errors` : ""}.` });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle — E&C number, registration, or description"
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-9 py-2.5 text-white text-xs placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
          />
          {search && (
            <button
              type="button"
              onClick={clearSearch}
              title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-500 whitespace-nowrap">
          {search.trim() ? `${visible.length} of ${bills.length}` : `${bills.length} bill${bills.length === 1 ? "" : "s"}`}
        </span>
      </form>

      {isAdmin && selected.size > 0 && (
        <div className="bg-[#1b1e30] border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-300 font-semibold">{selected.size} selected</span>
          <button
            onClick={runFinalize}
            disabled={pending || selectedDrafts.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-all"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Finalize {selectedDrafts.length || ""} draft{selectedDrafts.length === 1 ? "" : "s"}
          </button>
          <button
            onClick={runMarkPaid}
            disabled={pending || selectedPayable.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2 transition-all"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
            Mark {selectedPayable.length || ""} paid
          </button>
          {selectedDrafts.length > 0 && (
            <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
              <span className="text-[11px] text-gray-500 uppercase tracking-wider">Set basis</span>
              <button onClick={() => runSetBasis("d")} disabled={pending} title="Dry — rental only, no fuel" className="bg-amber-600/80 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold text-xs px-2.5 py-2 rounded-lg">Dry</button>
              <button onClick={() => runSetBasis("w")} disabled={pending} title="Wet — rental + fuel" className="bg-sky-600/80 hover:bg-sky-600 disabled:opacity-40 text-white font-semibold text-xs px-2.5 py-2 rounded-lg">Wet</button>
              <button onClick={() => runSetBasis("fw")} disabled={pending} title="Fully Wet" className="bg-sky-700/70 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold text-xs px-2.5 py-2 rounded-lg">F.Wet</button>
            </div>
          )}
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-white ml-auto">
            Clear
          </button>
        </div>
      )}

      {msg && (
        <div className={`text-xs rounded-xl px-4 py-3 border ${msg.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/10" : "bg-red-500/10 text-red-300 border-red-500/10"}`}>
          {msg.text}
        </div>
      )}

      <div className="border border-white/5 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              {isAdmin && (
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((b) => selected.has(b.id))}
                    onChange={toggleAll}
                    className="accent-indigo-500 w-3.5 h-3.5"
                  />
                </th>
              )}
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Site</th>
              <th className="px-4 py-3">Mode / Basis</th>
              <th className="px-4 py-3 text-right">Billable</th>
              <th className="px-4 py-3 text-right">Unit rate</th>
              <th className="px-4 py-3 text-right">Rental</th>
              <th className="px-4 py-3 text-right">Fuel</th>
              <th className="px-4 py-3 text-right">Grand Total</th>
              <th className="px-4 py-3">Meter check</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {visible.map((b) => (
              <tr key={b.id} className={`hover:bg-white/[0.02] ${selected.has(b.id) ? "bg-indigo-500/[0.04]" : ""}`}>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggle(b.id)}
                      className="accent-indigo-500 w-3.5 h-3.5"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/billing/${b.id}`} className="font-semibold text-white hover:text-indigo-400">
                    {b.assetCode}
                  </Link>
                  {b.assetRegNo && b.assetRegNo !== b.assetCode && (
                    <span className="text-gray-500 ml-1.5">· {b.assetRegNo}</span>
                  )}
                  <div className="text-gray-500">{b.assetLabel}</div>
                </td>
                <td className="px-4 py-3 text-gray-400">{b.projectName || "Unassigned"}</td>
                <td className="px-4 py-3 text-gray-400">
                  {MODE_LABEL[b.billingMode]} <span className="text-gray-600">·</span>{" "}
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${b.rateBasis === "d" ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400"}`}>
                    {b.rateBasis === "d" ? "Dry" : b.rateBasis === "fw" ? "F.Wet" : "Wet"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {b.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-400">{b.rateCents > 0 ? rs(b.rateCents) : "—"}</td>
                <td className="px-4 py-3 text-right text-gray-300">{rs(b.rentalAmountCents)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{b.fuelCostCents > 0 ? rs(b.fuelCostCents) : "—"}</td>
                <td className="px-4 py-3 text-right font-bold text-white">{rs(b.grandTotalCents)}</td>
                <td className="px-4 py-3">
                  {b.meterCheck ? (
                    <span
                      className="px-2 py-0.5 rounded text-[9px] font-bold border bg-amber-500/10 text-amber-400 border-amber-500/10 whitespace-nowrap"
                      title="Fuel-implied running differs from the running chart — clarify with the site (see the bill's usage panel)"
                    >
                      CLARIFY {b.meterCheck}
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${STATUS_STYLES[b.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="text-center py-12 px-6">
            <p className="text-sm text-gray-400">
              No vehicle matches <span className="text-white font-semibold">{search}</span> in this month.
            </p>
            <p className="text-[11px] text-gray-500 mt-2 max-w-md mx-auto">
              {looksLikePlate(search)
                ? "That looks like a registration number. Not every bill carries one — try the E&C number instead."
                : "Search matches the E&C number, the registration, or the description."}
            </p>
            <button onClick={clearSearch} className="text-xs text-indigo-400 hover:text-indigo-300 mt-3 font-semibold">
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
