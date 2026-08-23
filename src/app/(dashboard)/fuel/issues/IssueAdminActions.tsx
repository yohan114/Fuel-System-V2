"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Edit3, Ban, RotateCcw, History, Loader2, X, AlertTriangle } from "lucide-react";
import { editFuelIssueAction } from "@/app/actions/fuel";
import { voidFuelIssueAction, restoreFuelIssueAction, previewVoidFuelIssueAction } from "@/app/actions/fuel-void";
import { FUEL_KINDS } from "@/lib/fuel-kinds";

// Admin's row actions on the fuel issues log: edit, void, put back, and read
// what was done to it.
//
// Deliberately a row action rather than a page. The screen this sits on already
// renders the filters, the pump scoping and the table server-side; the previous
// attempt at this was a whole second copy of that page which was never mounted
// anywhere, and mounting it would have doubled every control on screen.

export interface AdminIssueRow {
  id: string;
  assetCode: string;
  litres: number;
  fuelKind: string;
  meterReading: number | null;
  source: string;
  issueDate: string;
  voided: boolean;
  bulkTankName: string | null;
  /** Locked to the tank's product when the issue came out of a pump. */
  tankLocked: boolean;
}

export interface HistoryEntry {
  at: string;
  who: string | null;
  summary: string;
}

const fmtDateInput = (iso: string) => {
  // The input wants Colombo wall-clock, which is what the operator wrote down.
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function IssueAdminActions({ issue, history }: { issue: AdminIssueRow; history: HistoryEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "edit" | "void" | "history">(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewVoidFuelIssueAction>> | null>(null);

  const close = () => { setOpen(null); setMsg(null); setReason(""); setPreview(null); };

  const run = (fn: () => Promise<{ error?: string; success?: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.error) { setMsg({ ok: false, text: r.error }); return; }
      setMsg({ ok: true, text: r.message ?? "Done." });
      setTimeout(() => { close(); router.refresh(); }, 1400);
    });

  const openVoid = () => {
    setOpen("void"); setMsg(null); setReason(""); setPreview(null);
    // Ask the server what this would cost before anyone commits to it.
    startTransition(async () => setPreview(await previewVoidFuelIssueAction(issue.id)));
  };

  const btn = "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40";
  const field = "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50";
  const label = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5";
  const p = preview && "preview" in preview ? preview.preview : null;

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {!issue.voided && (
          <button onClick={() => { setOpen("edit"); setMsg(null); }} className={`${btn} text-indigo-400 hover:bg-indigo-500/10`} title="Edit this issue">
            <Edit3 className="w-3 h-3" /> Edit
          </button>
        )}
        {issue.voided ? (
          <button onClick={() => run(() => restoreFuelIssueAction(issue.id))} disabled={pending} className={`${btn} text-emerald-400 hover:bg-emerald-500/10`} title="Put this issue back in the books">
            <RotateCcw className="w-3 h-3" /> Restore
          </button>
        ) : (
          <button onClick={openVoid} className={`${btn} text-red-400 hover:bg-red-500/10`} title="Take this issue out of the books">
            <Ban className="w-3 h-3" /> Void
          </button>
        )}
        <button onClick={() => { setOpen("history"); setMsg(null); }} className={`${btn} text-gray-400 hover:bg-white/5`} title="What has been done to this issue">
          <History className="w-3 h-3" />
          {history.length > 0 && <span>{history.length}</span>}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4 text-left max-h-[90vh] overflow-y-auto">
            <button onClick={close} className="absolute right-6 top-6 text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5">
              <X className="w-4 h-4" />
            </button>

            {msg && (
              <div className={`text-xs rounded-xl px-3 py-2.5 border ${msg.ok ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"}`}>
                {msg.text}
              </div>
            )}

            {/* ── Edit ─────────────────────────────────────────────────── */}
            {open === "edit" && (
              <>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Edit fuel issue · {issue.assetCode}</h3>
                <p className="text-[11px] text-gray-400">
                  Changing the litres moves the tank balance with it, and the month&apos;s bill is redone.
                  Everything you change is recorded against your name, before and after.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    run(() => editFuelIssueAction(issue.id, fd));
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className={label}>Machine</label>
                    <input name="assetCode" required defaultValue={issue.assetCode} className={`${field} uppercase font-semibold`} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Litres</label>
                      <input name="litres" type="number" step="0.1" min="0.1" required defaultValue={issue.litres} className={field} />
                    </div>
                    <div>
                      <label className={label}>Fuel</label>
                      {issue.tankLocked ? (
                        <>
                          <input disabled value={issue.fuelKind.replace(/_/g, " ")} className={`${field} opacity-50`} />
                          <input type="hidden" name="fuelKind" value={issue.fuelKind} />
                        </>
                      ) : (
                        <select name="fuelKind" defaultValue={issue.fuelKind} className={field}>
                          {FUEL_KINDS.map((k) => <option key={k.code} value={k.code}>{k.short}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Meter reading</label>
                      <input name="meterReading" type="number" step="0.1" min="0" placeholder="none" defaultValue={issue.meterReading ?? ""} className={field} />
                    </div>
                    <div>
                      <label className={label}>Source</label>
                      <input name="source" required defaultValue={issue.source} className={field} />
                    </div>
                  </div>
                  <div>
                    <label className={label}>Date &amp; time</label>
                    <input name="issueDate" type="datetime-local" required defaultValue={fmtDateInput(issue.issueDate)} className={field} />
                  </div>
                  <div>
                    <label className={label}>Why (goes on the record)</label>
                    <input name="reason" placeholder="e.g. operator wrote 40 instead of 60" className={field} />
                  </div>
                  <button type="submit" disabled={pending} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2">
                    {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
                  </button>
                </form>
              </>
            )}

            {/* ── Void ─────────────────────────────────────────────────── */}
            {open === "void" && (
              <>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> Void {issue.litres} L · {issue.assetCode}
                </h3>
                {!p ? (
                  <p className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> working out what this changes…</p>
                ) : (
                  <div className="text-[11px] text-gray-300 space-y-1.5 bg-white/[0.03] border border-white/5 rounded-xl p-3">
                    <p>The issue stays on record, marked void, and stops counting anywhere.</p>
                    {p.tankName && <p>· <strong>{p.litres} L</strong> returns to {p.tankName} — balance becomes {p.tankBalanceAfter?.toLocaleString(undefined, { maximumFractionDigits: 1 })} L</p>}
                    {p.hasMeterReading && <p>· the meter reading stays; it is a reading of the machine either way</p>}
                    {p.billStatus === "DRAFT" && (
                      <p>· {p.billSite ?? "the"} <strong>{p.periodKey}</strong> draft bill is redone
                        {p.lastFuelOfMonth ? " — and removed, since this is the machine's last fuel that month" : ""}</p>
                    )}
                    {p.billStatus && p.billStatus !== "DRAFT" && (
                      <p className="text-red-300">· its {p.periodKey} invoice is {p.billStatus}{p.billInvoiceNumber ? ` (${p.billInvoiceNumber})` : ""} — this will be refused; raise a credit note</p>
                    )}
                    {!p.billStatus && <p>· no bill exists for {p.periodKey}, so nothing to redo</p>}
                  </div>
                )}
                <div>
                  <label className={label}>Why (required)</label>
                  <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered twice from the same sheet" className={field} />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={pending || reason.trim().length < 4}
                    onClick={() => run(() => voidFuelIssueAction(issue.id, reason))}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Void it
                  </button>
                  <button onClick={close} className="px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold border border-white/5">Cancel</button>
                </div>
              </>
            )}

            {/* ── History ──────────────────────────────────────────────── */}
            {open === "history" && (
              <>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">History · {issue.assetCode}</h3>
                {history.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Nothing has been done to this issue since it was recorded. Rows brought in by a
                    bulk import carry no entry — the trail starts when someone touches it here.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {history.map((h, i) => (
                      <li key={i} className="text-[11px] border-l-2 border-indigo-500/40 pl-3">
                        <div className="text-gray-400">
                          {new Date(h.at).toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {h.who ? ` · ${h.who}` : ""}
                        </div>
                        <div className="text-gray-200 mt-0.5">{h.summary}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={close} className="w-full bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold py-2.5 border border-white/5">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
