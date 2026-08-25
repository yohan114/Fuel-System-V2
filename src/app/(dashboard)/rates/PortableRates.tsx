"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Package, Search, Wand2 } from "lucide-react";
import type { PortableOverview, PortableMachineRow } from "@/lib/consumption/portable-overview";
import { PORTABLE_CARD_SOURCE, MATCH_LABEL } from "@/lib/consumption/portable-rate-card";
import { applyPortableClassAction, fillMissingPortableWetAction } from "@/app/actions/rates";

const money = (c: number | null) => (c == null ? "—" : (c / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 }));

const MATCH_STYLE: Record<string, string> = {
  exact: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  "dry-only": "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "wet-only": "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "off-card": "bg-sky-500/10 text-sky-400 border-sky-500/30",
  unpriced: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

/** Puts a machine on a card class, copying both day rates onto it. */
function ClassPicker({
  row, classes, canEdit,
}: {
  row: PortableMachineRow;
  classes: { id: string; category: string; size: string; wetCents: number; dryCents: number }[];
  canEdit: boolean;
}) {
  const [chosen, setChosen] = useState(row.matchedClassId ?? "");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g = new Map<string, typeof classes>();
    for (const k of classes) g.set(k.category, [...(g.get(k.category) ?? []), k]);
    return [...g.entries()];
  }, [classes]);

  if (!canEdit) {
    const cls = classes.find((k) => k.id === row.matchedClassId);
    return <span className="text-[10px] text-gray-500">{cls ? `${cls.category} · ${cls.size}` : "—"}</span>;
  }

  return (
    <div>
      <select
        value={chosen}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = chosen;
          if (!next) return;
          setChosen(next);
          setFailed(null);
          startTransition(async () => {
            const r = await applyPortableClassAction({ assetId: row.assetId, classId: next });
            if (r.error) { setChosen(prev); setFailed(r.error); }
          });
        }}
        className={`bg-[#1b1e30] border border-white/10 rounded px-1.5 py-1 text-[10px] text-gray-200 max-w-[15rem] focus:outline-none focus:border-indigo-500/50 ${pending ? "opacity-50" : ""}`}
      >
        <option value="">— pick a class —</option>
        {grouped.map(([cat, ks]) => (
          <optgroup key={cat} label={cat}>
            {ks.map((k) => (
              <option key={k.id} value={k.id}>
                {k.size} — {money(k.wetCents)} wet / {money(k.dryCents)} dry
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {failed ? <span className="block text-[9px] text-rose-400 mt-0.5">{failed}</span> : null}
    </div>
  );
}

export default function PortableRates({ data, canEdit }: { data: PortableOverview; canEdit: boolean }) {
  const { classes, machines, counts } = data;
  const [q, setQ] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [filling, startFill] = useTransition();
  const [fillNote, setFillNote] = useState<string | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return machines.filter((m) => {
      if (onlyGaps && m.match === "exact") return false;
      if (!term) return true;
      return (
        m.code.toLowerCase().includes(term) ||
        (m.typeLabel ?? "").toLowerCase().includes(term) ||
        (m.categoryName ?? "").toLowerCase().includes(term) ||
        (m.projectName ?? "").toLowerCase().includes(term)
      );
    });
  }, [machines, q, onlyGaps]);

  return (
    <div className="space-y-6">
      {/* ── the card itself ─────────────────────────────────────────────── */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-400" />
            Portable equipment — day-hire rates
          </h2>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Portable plant carries no meter anybody reads, so it is not priced by the hour or the kilometre — it goes
            out for a day at a flat rate. <span className="text-gray-300">Wet</span> includes fuel or power, an operator
            and routine consumables; <span className="text-gray-300">Dry</span> is the bare machine. Both exclude 18%
            VAT and transport, and a part day bills as a full one.
          </p>
          <p className="text-[10px] text-gray-600 mt-1">{PORTABLE_CARD_SOURCE}</p>
        </div>

        <div className="overflow-x-auto max-h-[26rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0d0f1a] text-gray-500 sticky top-0">
              <tr>
                <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Category</th>
                <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Capacity / size</th>
                <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Wet Rs/day</th>
                <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Dry Rs/day</th>
                <th className="text-center font-semibold uppercase tracking-wider px-3 py-3">Min.</th>
                <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">In fleet</th>
                <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Basis of the figure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {classes.map((k, i) => {
                const newCat = i === 0 || classes[i - 1].category !== k.category;
                return (
                  <tr key={k.id} className="hover:bg-white/[0.02]">
                    <td className={`px-4 py-2 ${newCat ? "text-white font-semibold" : "text-gray-700"}`}>
                      {newCat ? k.category : ""}
                    </td>
                    <td className="px-3 py-2 text-gray-300">{k.size}</td>
                    <td className="px-3 py-2 text-right text-white font-semibold tabular-nums">{money(k.wetCents)}</td>
                    <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{money(k.dryCents)}</td>
                    <td className="px-3 py-2 text-center text-gray-600 text-[10px]">{k.minimum}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {k.fleetCount > 0 ? (
                        <span className="text-indigo-400 font-semibold" title={k.codes.join(", ")}>
                          {k.fleetCount}
                        </span>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 text-[10px]">{k.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── the fleet sitting on it ─────────────────────────────────────── */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Portable plant in the fleet — {counts.total} machines
            </h2>
            <p className="text-[11px] text-gray-400 mt-1">
              {counts.onCard} sit exactly on a card class.{" "}
              {counts.dryOnly > 0 ? (
                <span className="text-amber-400">
                  {counts.dryOnly} carry the dry figure with the wet side never filled in — hire one of those out wet
                  and it prices at nothing.
                </span>
              ) : null}{" "}
              {counts.offCard > 0 ? `${counts.offCard} are off the card entirely.` : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="bg-[#1b1e30] border border-white/5 rounded-lg pl-8 pr-3 py-2 text-white text-xs w-36 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <button
              onClick={() => setOnlyGaps((v) => !v)}
              className={`text-[10px] font-semibold px-3 py-2 rounded-lg border transition ${
                onlyGaps ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#1b1e30] border-white/5 text-gray-400 hover:text-white"
              }`}
            >
              Only gaps
            </button>
            {canEdit && counts.fillable > 0 ? (
              <button
                disabled={filling}
                onClick={() => {
                  setFillNote(null);
                  startFill(async () => {
                    const r = await fillMissingPortableWetAction();
                    setFillNote(r.error ?? r.message ?? null);
                  });
                }}
                className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[10px] font-semibold px-3 py-2 rounded-lg transition"
                title="Writes the card's wet rate only where none is set. Nothing already priced is touched."
              >
                <Wand2 className="w-3.5 h-3.5" />
                Fill {counts.fillable} missing wet {counts.fillable === 1 ? "rate" : "rates"}
              </button>
            ) : null}
          </div>
        </div>

        {fillNote ? (
          <div className="px-4 py-2 text-[11px] text-amber-300 bg-amber-500/5 border-b border-white/5">{fillNote}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0d0f1a] text-gray-500">
              <tr>
                <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Machine</th>
                <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Register says</th>
                <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Site</th>
                <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Wet Rs/day</th>
                <th className="text-right font-semibold uppercase tracking-wider px-3 py-3">Dry Rs/day</th>
                <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Bills on</th>
                <th className="text-left font-semibold uppercase tracking-wider px-3 py-3">Card class</th>
                <th className="text-left font-semibold uppercase tracking-wider px-4 py-3">Standing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.map((m) => (
                <tr key={m.assetId} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/fleet/${encodeURIComponent(m.code)}`} className="text-white font-semibold hover:text-indigo-400">
                      {m.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">
                    {m.categoryName ?? "—"}
                    {m.typeLabel && m.typeLabel !== m.categoryName ? (
                      <span className="text-gray-700"> · {m.typeLabel.slice(0, 24)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{m.projectName ?? "unassigned"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${m.wetCents == null ? "text-rose-400" : "text-gray-200"}`}>
                    {money(m.wetCents)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${m.dryCents == null ? "text-gray-600" : "text-gray-200"}`}>
                    {money(m.dryCents)}
                  </td>
                  <td className="px-3 py-2.5 text-[10px] text-gray-400">
                    {m.defaultBasis === "d" ? "Dry" : m.defaultBasis === "w" ? "Wet" : "unset → wet"}
                  </td>
                  <td className="px-3 py-2.5">
                    <ClassPicker row={m} classes={classes} canEdit={canEdit} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${MATCH_STYLE[m.match]}`}>
                      {MATCH_LABEL[m.match as keyof typeof MATCH_LABEL]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-gray-500">No portable machines match that filter.</div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="px-4 py-3 border-t border-white/5 text-[10px] text-gray-500">
            Choosing a class copies both of its day rates onto the machine. Bills already issued keep the rate they were
            raised at; a draft picks the new figure up when its month is next regenerated. Every change is recorded in
            the audit log.
          </div>
        ) : null}
      </div>
    </div>
  );
}
