"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Minus, Undo2, SlidersHorizontal, AlertTriangle } from "lucide-react";
import {
  addVehicleToSiteBillingAction,
  removeVehicleFromSiteBillingAction,
  clearSiteBillingOverrideAction,
  createAndAddVehicleAction,
} from "@/app/actions/billing-overrides";
import type { SiteRoster, RosterEntry } from "@/lib/billing/site-roster";

const rs = (c: number) => "Rs. " + (c / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString("en-LK", { maximumFractionDigits: 1 });

export default function SiteBillingAdvanced({ roster }: { roster: SiteRoster }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Which row is asking for a reason, and what has been typed into it.
  const [asking, setAsking] = useState<{ assetId: string; mode: "add" | "remove" } | null>(null);
  const [reason, setReason] = useState("");
  const [newItem, setNewItem] = useState({ code: "", description: "", dayRate: "", meterType: "NONE" });
  const [showNew, setShowNew] = useState(false);

  const run = (fn: () => Promise<{ error?: string; success?: boolean; message?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Done." });
      if (!r.error) {
        setAsking(null);
        setReason("");
        setShowNew(false);
        setNewItem({ code: "", description: "", dayRate: "", meterType: "NONE" });
        router.refresh();
      }
    });
  };

  const add = (assetId: string, why?: string, fuelOnly?: boolean) =>
    run(() => addVehicleToSiteBillingAction({ assetId, projectId: roster.projectId, periodKey: roster.periodKey, reason: why, fuelOnly }));
  const remove = (assetId: string, why?: string) =>
    run(() => removeVehicleFromSiteBillingAction({ assetId, projectId: roster.projectId, periodKey: roster.periodKey, reason: why }));

  const cell = "px-3 py-2";
  const btn = "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none";

  const Name = ({ e }: { e: RosterEntry }) => (
    <div>
      <span className="font-semibold text-white">{e.code}</span>
      {e.regNo && e.regNo !== e.code && <span className="text-gray-500 ml-1.5">· {e.regNo}</span>}
      {e.label && <div className="text-gray-500 text-[10px]">{e.label}</div>}
      {e.override && (
        <div className="text-[10px] text-indigo-400 mt-0.5">
          {e.override.action === "ADD" ? "added" : "removed"} by hand
          {e.override.by ? ` · ${e.override.by}` : ""}
          {e.override.reason ? ` · ${e.override.reason}` : ""}
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl shadow-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2.5 text-left">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <div>
            <div className="text-sm font-bold text-white">Advanced — what is on {roster.projectName}&apos;s bill</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {roster.billed.length} billed · {rs(roster.billedTotalCents)}
              {roster.candidates.length > 0 && (
                <> · <span className="text-amber-400">{roster.candidates.length} on site but not billed</span></>
              )}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-white/5 p-5 space-y-5">
          {msg && (
            <div className={`text-xs rounded-xl px-3 py-2.5 border ${msg.ok ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"}`}>
              {msg.text}
            </div>
          )}

          {/* ── On the bill ─────────────────────────────────────────────── */}
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              On this site&apos;s bill for {roster.periodKey}
            </h4>
            {roster.billed.length === 0 ? (
              <p className="text-xs text-gray-500 py-3">Nothing is billed to this site this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
                    <tr>
                      <th className={cell}>Vehicle</th>
                      <th className={cell}>Days here</th>
                      <th className={`${cell} text-right`}>Fuel here</th>
                      <th className={`${cell} text-right`}>This site&apos;s share</th>
                      <th className={cell}>Also at</th>
                      <th className={cell}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {roster.billed.map((e) => (
                      <React.Fragment key={e.assetId}>
                        <tr className="hover:bg-white/[0.02]">
                          <td className={cell}>
                            {e.billId ? <Link href={`/billing/${e.billId}`}><Name e={e} /></Link> : <Name e={e} />}
                          </td>
                          <td className={`${cell} text-gray-400`}>{e.daysHere || "—"}</td>
                          <td className={`${cell} text-right text-gray-400`}>{e.fuelHereLitres > 0 ? `${n1(e.fuelHereLitres)} L` : "—"}</td>
                          <td className={`${cell} text-right font-bold text-white`}>{rs(e.amountCents)}</td>
                          <td className={`${cell} text-gray-500`}>{e.alsoAt.join(", ") || "—"}</td>
                          <td className={`${cell} text-right whitespace-nowrap`}>
                            {e.override && (
                              <button
                                disabled={pending}
                                onClick={() => run(() => clearSiteBillingOverrideAction(e.override!.id))}
                                className={`${btn} bg-white/5 hover:bg-white/10 text-gray-300 mr-1.5`}
                                title="Undo the hand-made decision and follow the records again"
                              >
                                <Undo2 className="w-3 h-3" /> Undo
                              </button>
                            )}
                            {e.billStatus === "DRAFT" ? (
                              <button
                                disabled={pending}
                                onClick={() => { setAsking({ assetId: e.assetId, mode: "remove" }); setReason(""); }}
                                className={`${btn} bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20`}
                              >
                                <Minus className="w-3 h-3" /> Remove
                              </button>
                            ) : (
                              <span className="text-[10px] text-gray-500" title="Issued invoices are corrected by credit note">
                                {e.billStatus}
                              </span>
                            )}
                          </td>
                        </tr>
                        {asking?.assetId === e.assetId && asking.mode === "remove" && (
                          <ReasonRow
                            colSpan={6}
                            label={`Why is ${e.code} not ${roster.projectName}'s this month?`}
                            placeholder="e.g. site says it never arrived — transferred straight to Marawila"
                            value={reason}
                            onChange={setReason}
                            pending={pending}
                            onCancel={() => setAsking(null)}
                            onConfirm={() => remove(e.assetId, reason)}
                            confirmLabel="Remove from this bill"
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── On site, not billed ─────────────────────────────────────── */}
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              On site but not billed
            </h4>
            {roster.candidates.length === 0 ? (
              <p className="text-xs text-gray-500 py-3">Everything on site this month is on the bill.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
                    <tr>
                      <th className={cell}>Vehicle</th>
                      <th className={`${cell} text-right`}>Fuel from this pump</th>
                      <th className={cell}>Why not billed</th>
                      <th className={cell}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {roster.candidates.map((e) => (
                      <React.Fragment key={e.assetId}>
                        <tr className="hover:bg-white/[0.02]">
                          <td className={cell}><Name e={e} /></td>
                          <td className={`${cell} text-right ${e.fuelHereLitres > 0 ? "text-amber-300 font-semibold" : "text-gray-500"}`}>
                            {e.fuelHereLitres > 0 ? `${n1(e.fuelHereLitres)} L` : "—"}
                          </td>
                          <td className={`${cell} text-gray-400`}>{e.reason}</td>
                          <td className={`${cell} text-right whitespace-nowrap`}>
                            {e.override?.action === "REMOVE" ? (
                              <button
                                disabled={pending}
                                onClick={() => run(() => clearSiteBillingOverrideAction(e.override!.id))}
                                className={`${btn} bg-white/5 hover:bg-white/10 text-gray-300`}
                              >
                                <Undo2 className="w-3 h-3" /> Undo removal
                              </button>
                            ) : (
                              <>
                                {/* An unpriced item that burnt diesel can still be
                                    charged for the diesel — that is most of what
                                    this panel is for. */}
                                {!e.hasRate && e.fuelHereLitres > 0 && (
                                  <button
                                    disabled={pending}
                                    onClick={() => add(e.assetId, undefined, true)}
                                    className={`${btn} bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/20 mr-1.5`}
                                    title="Charge the diesel it drew here, no rental"
                                  >
                                    <Plus className="w-3 h-3" /> Fuel only
                                  </button>
                                )}
                                <button
                                  disabled={pending}
                                  onClick={() => {
                                    // Fuel from this pump is evidence enough; anything
                                    // else has to be justified in writing.
                                    if (e.fuelHereLitres > 0) add(e.assetId);
                                    else { setAsking({ assetId: e.assetId, mode: "add" }); setReason(""); }
                                  }}
                                  className={`${btn} bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/20`}
                                >
                                  <Plus className="w-3 h-3" /> Add to bill
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        {asking?.assetId === e.assetId && asking.mode === "add" && (
                          <ReasonRow
                            colSpan={4}
                            label={`${e.code} drew no fuel from this pump. Why should ${roster.projectName} be charged?`}
                            placeholder="e.g. stood on site all month at the client's request"
                            value={reason}
                            onChange={setReason}
                            pending={pending}
                            onCancel={() => setAsking(null)}
                            onConfirm={() => add(e.assetId, reason)}
                            confirmLabel="Bill it anyway"
                            warn
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Not in the fleet at all ─────────────────────────────────── */}
          <div className="border-t border-white/5 pt-4">
            {!showNew ? (
              <button
                onClick={() => setShowNew(true)}
                className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/5`}
              >
                <Plus className="w-3 h-3" /> Item not in the fleet
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-gray-400">
                  For the small items nobody registered — pokers, rammers, grass cutters, light towers.
                  Leave the day rate blank and it is billed for its diesel only.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    value={newItem.code}
                    onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
                    placeholder="Code e.g. POKER-02"
                    className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                  />
                  <input
                    value={newItem.description}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                    placeholder="Description"
                    className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                  />
                  <input
                    value={newItem.dayRate}
                    onChange={(e) => setNewItem({ ...newItem, dayRate: e.target.value.replace(/[^\d.]/g, "") })}
                    placeholder="Rs / day (blank = fuel only)"
                    className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={pending || newItem.code.trim().length < 2}
                      onClick={() =>
                        run(() =>
                          createAndAddVehicleAction({
                            code: newItem.code,
                            description: newItem.description,
                            projectId: roster.projectId,
                            periodKey: roster.periodKey,
                            meterType: newItem.meterType,
                            dayRateRupees: newItem.dayRate ? parseFloat(newItem.dayRate) : 0,
                          })
                        )
                      }
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl py-2.5 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Create & add"}
                    </button>
                    <button
                      onClick={() => setShowNew(false)}
                      className="px-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold border border-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-500 border-t border-white/5 pt-3">
            Every change here applies to {roster.periodKey} only and is recorded against your name. The bill is
            regenerated immediately. Issued invoices are never altered — those need a credit note.
          </p>
        </div>
      )}
    </div>
  );
}

function ReasonRow({
  colSpan, label, placeholder, value, onChange, pending, onCancel, onConfirm, confirmLabel, warn = false,
}: {
  colSpan: number; label: string; placeholder: string; value: string;
  onChange: (v: string) => void; pending: boolean;
  onCancel: () => void; onConfirm: () => void; confirmLabel: string; warn?: boolean;
}) {
  return (
    <tr className="bg-white/[0.02]">
      <td colSpan={colSpan} className="px-3 py-3">
        <div className="flex items-start gap-2 mb-2">
          {warn && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />}
          <span className="text-[11px] text-gray-300">{label}</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
          <button
            disabled={pending || value.trim().length < 4}
            onClick={onConfirm}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold border border-white/5"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
