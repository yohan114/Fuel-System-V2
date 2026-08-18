"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Scissors, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { endAssignmentAction, deleteAssignmentAction } from "@/app/actions/assignment";
import type { AssignmentOverlap } from "@/lib/assignments/overlaps";

function fmt(ymd: string) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function OverlapResolver({ overlaps }: { overlaps: AssignmentOverlap[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (overlaps.length === 0) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-4 mb-6 text-xs text-emerald-400 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" /> No overlapping postings — multi-site bills split cleanly.
      </div>
    );
  }

  function run(key: string, fn: () => Promise<{ error?: string } | { success?: boolean }>, ok: string) {
    setBusyKey(key);
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      const err = "error" in res ? res.error : undefined;
      if (err) setMsg({ ok: false, text: err });
      else {
        setMsg({ ok: true, text: ok });
        router.refresh();
      }
      setBusyKey(null);
    });
  }

  return (
    <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-rose-400" /> Overlapping postings
        </h3>
        <span className="text-xs font-bold text-rose-400">{overlaps.length}</span>
      </div>
      <p className="text-[11px] text-gray-400">
        These vehicles are posted to two sites on the same days, so their multi-site bill double-counts the rental.
        Trim the earlier posting to end before the next one starts, or delete the wrong one.
      </p>

      {msg && (
        <div className={`text-xs rounded-xl px-4 py-2.5 border ${msg.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/10" : "bg-red-500/10 text-red-300 border-red-500/10"}`}>
          {msg.text}
        </div>
      )}

      <div className="space-y-2">
        {overlaps.map((o, i) => {
          const key = `${o.earlier.id}-${o.later.id}`;
          const busy = pending && busyKey?.startsWith(key);
          return (
            <div key={key + i} className="bg-[#121420] border border-white/5 rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono font-bold text-white w-20 shrink-0">{o.assetCode}</span>
              <span className="text-xs text-gray-300 flex-1 min-w-[220px]">
                <span className="text-indigo-300 font-semibold">{o.earlier.projectCode}</span> ({fmt(o.earlier.start)} → {o.earlier.end ? fmt(o.earlier.end) : "open"})
                <span className="text-gray-500"> overlaps </span>
                <span className="text-amber-300 font-semibold">{o.later.projectCode}</span> ({fmt(o.later.start)} → {o.later.end ? fmt(o.later.end) : "open"})
              </span>
              <div className="flex items-center gap-1.5">
                {o.suggestedEnd ? (
                  <button
                    onClick={() => run(`${key}-trim`, () => endAssignmentAction(o.earlier.id, o.suggestedEnd!), `Trimmed ${o.assetCode} · ${o.earlier.projectCode} to ${fmt(o.suggestedEnd!)}.`)}
                    disabled={pending}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                    title={`End ${o.earlier.projectCode} on ${fmt(o.suggestedEnd)}`}
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                    Trim to {fmt(o.suggestedEnd)}
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-500">same start day — delete one:</span>
                )}
                <button
                  onClick={() => run(`${key}-del1`, () => deleteAssignmentAction(o.earlier.id), `Removed ${o.assetCode} · ${o.earlier.projectCode} posting.`)}
                  disabled={pending}
                  className="bg-white/5 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                  title={`Delete the ${o.earlier.projectCode} posting`}
                >
                  <Trash2 className="w-3 h-3" /> {o.earlier.projectCode}
                </button>
                <button
                  onClick={() => run(`${key}-del2`, () => deleteAssignmentAction(o.later.id), `Removed ${o.assetCode} · ${o.later.projectCode} posting.`)}
                  disabled={pending}
                  className="bg-white/5 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                  title={`Delete the ${o.later.projectCode} posting`}
                >
                  <Trash2 className="w-3 h-3" /> {o.later.projectCode}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
