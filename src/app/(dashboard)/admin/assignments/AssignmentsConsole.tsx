"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAssignmentAction,
  endAssignmentAction,
  deleteAssignmentAction,
} from "@/app/actions/assignment";
import {
  Building2,
  Car,
  CalendarRange,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  StopCircle,
  Trash2,
} from "lucide-react";

interface Project {
  id: string;
  code: string;
  name: string;
}
interface AssetOpt {
  id: string;
  code: string;
  brand: string | null;
  typeLabel: string | null;
  regNo: string | null;
  meterType: string;
}
interface Assignment {
  id: string;
  startDate: string;
  endDate: string | null;
  note: string | null;
  asset: { code: string; brand: string | null; typeLabel: string | null };
  project: { id: string; code: string; name: string };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AssignmentsConsole({
  projects,
  assets,
  initialAssignments,
}: {
  projects: Project[];
  assets: AssetOpt[];
  initialAssignments: Assignment[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [assetSearch, setAssetSearch] = useState("");
  const [assetId, setAssetId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    if (!q) return assets.slice(0, 200);
    return assets
      .filter(
        (a) =>
          a.code.toLowerCase().includes(q) ||
          (a.regNo || "").toLowerCase().includes(q) ||
          (a.brand || "").toLowerCase().includes(q)
      )
      .slice(0, 200);
  }, [assets, assetSearch]);

  const grouped = useMemo(() => {
    const map = new Map<string, { project: Project; rows: Assignment[] }>();
    for (const a of initialAssignments) {
      const key = a.project.id;
      if (!map.has(key)) map.set(key, { project: a.project, rows: [] });
      map.get(key)!.rows.push(a);
    }
    return [...map.values()].sort((x, y) => x.project.name.localeCompare(y.project.name));
  }, [initialAssignments]);

  function flash(type: "success" | "error", text: string) {
    setMessage({ type, text });
    if (type === "success") setTimeout(() => setMessage(null), 3500);
  }

  function submit() {
    if (!assetId || !projectId || !startDate) {
      flash("error", "Pick a vehicle, a site and a start date.");
      return;
    }
    const fd = new FormData();
    fd.set("assetId", assetId);
    fd.set("projectId", projectId);
    fd.set("startDate", startDate);
    if (endDate) fd.set("endDate", endDate);
    if (note) fd.set("note", note);

    startTransition(async () => {
      const res = await createAssignmentAction(fd);
      if (res?.error) {
        flash("error", res.error);
      } else {
        flash("success", "Vehicle assigned.");
        setAssetId("");
        setAssetSearch("");
        setEndDate("");
        setNote("");
        router.refresh();
      }
    });
  }

  function endToday(id: string) {
    startTransition(async () => {
      const res = await endAssignmentAction(id, todayStr());
      if (res?.error) flash("error", res.error);
      else {
        flash("success", "Assignment ended.");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteAssignmentAction(id);
      if (res?.error) flash("error", res.error);
      else {
        flash("success", "Assignment removed.");
        router.refresh();
      }
    });
  }

  const inputCls =
    "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50";

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`flex items-start gap-2.5 rounded-xl p-4 text-xs font-semibold tracking-wide border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 border-red-500/10 text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* New assignment form */}
      <div className="bg-[#0f111b] border border-white/5 rounded-2xl p-5 shadow-lg">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-400" /> Assign a vehicle to a site
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-gray-500 font-semibold uppercase">Vehicle</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                className={inputCls + " pl-9 mb-2"}
                placeholder="Search code / plate / brand…"
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
              />
            </div>
            <select className={inputCls} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— select vehicle —</option>
              {filteredAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.brand ? `· ${a.brand}` : ""} {a.regNo ? `[${a.regNo}]` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-gray-500 font-semibold uppercase">Site / Project</label>
            <select
              className={inputCls + " mt-1"}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— select site —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
              Leave the end date empty for an ongoing posting. Re-assigning the same vehicle later
              automatically closes the previous posting the day before the new start.
            </p>
          </div>

          <div>
            <label className="text-[10px] text-gray-500 font-semibold uppercase">Start date</label>
            <input
              type="date"
              className={inputCls + " mt-1"}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 font-semibold uppercase">End date (optional)</label>
            <input
              type="date"
              className={inputCls + " mt-1"}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-[10px] text-gray-500 font-semibold uppercase">Note (optional)</label>
            <input
              className={inputCls + " mt-1"}
              placeholder="e.g. road works package, operator name…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={isPending}
          className="mt-4 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-5 py-2.5 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" /> {isPending ? "Saving…" : "Assign vehicle"}
        </button>
      </div>

      {/* Current roster grouped by site */}
      <div className="space-y-5">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-indigo-400" /> Current &amp; this-month roster
        </h3>

        {grouped.length === 0 ? (
          <div className="bg-[#121420] border border-white/5 rounded-2xl py-12 text-center text-xs text-gray-500">
            No active assignments yet. Assign a vehicle above to get started.
          </div>
        ) : (
          grouped.map(({ project, rows }) => (
            <div key={project.id} className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-white/5 border-b border-white/5">
                <Building2 className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">{project.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">({project.code})</span>
                <span className="ml-auto text-[10px] text-gray-500">{rows.length} vehicle{rows.length !== 1 ? "s" : ""}</span>
              </div>
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-white/5">
                  {rows.map((r) => {
                    const ongoing = !r.endDate;
                    return (
                      <tr key={r.id} className="hover:bg-white/[0.02]">
                        <td className="px-5 py-3">
                          <span className="flex items-center gap-2 font-bold text-white">
                            <Car className="w-3.5 h-3.5 text-gray-500" />
                            {r.asset.code}
                          </span>
                          {r.note && <span className="text-[10px] text-gray-500 block mt-0.5 ml-5">{r.note}</span>}
                        </td>
                        <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                          {fmt(r.startDate)} → {ongoing ? <span className="text-emerald-400 font-semibold">ongoing</span> : fmt(r.endDate!)}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          {ongoing && (
                            <button
                              onClick={() => endToday(r.id)}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/10 rounded-lg px-2.5 py-1.5 mr-2 disabled:opacity-50"
                            >
                              <StopCircle className="w-3 h-3" /> End today
                            </button>
                          )}
                          <button
                            onClick={() => remove(r.id)}
                            disabled={isPending}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-300 hover:text-red-200 bg-red-500/10 border border-red-500/10 rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" /> Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
