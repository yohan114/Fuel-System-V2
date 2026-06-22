"use client";

import React, { useState } from "react";
import { resolveAliasAction } from "@/app/actions/inventory";

interface ProjectOpt { id: string; name: string }

// Map one unresolved consumer description to a machine or project. On success
// the action back-fills matching historical issues.
export default function ResolveForm({ aliasId, projects }: { aliasId: string; projects: ProjectOpt[] }) {
  const [mode, setMode] = useState<"ASSET" | "PROJECT">("ASSET");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const fd = new FormData(form);
    fd.set("aliasId", aliasId);
    fd.set("targetType", mode);
    const res = await resolveAliasAction(fd);
    setPending(false);
    if (res?.error) setMsg(res.error);
    // On success the row disappears on revalidate; no further UI needed.
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <select value={mode} onChange={(e) => setMode(e.target.value as "ASSET" | "PROJECT")} className="bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1.5 text-white text-xs">
        <option value="ASSET">Machine</option>
        <option value="PROJECT">Project</option>
      </select>
      {mode === "ASSET" ? (
        <input type="text" name="assetCode" required placeholder="E&C code e.g. HEX-12" className="bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1.5 text-white text-xs font-mono uppercase w-40" />
      ) : (
        <select name="projectId" required className="bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1.5 text-white text-xs w-48">
          <option value="">Select project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <button type="submit" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg px-3 py-1.5">
        {pending ? "…" : "Map"}
      </button>
      {msg && <span className="text-[10px] text-red-400">{msg}</span>}
    </form>
  );
}
