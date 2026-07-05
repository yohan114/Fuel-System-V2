"use client";

import React, { useState } from "react";
import { recordTankDipAction } from "@/app/actions/integrity";

export default function TankDipForm({ tanks }: { tanks: { id: string; name: string }[] }) {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await recordTankDipAction(new FormData(form));
    setPending(false);
    if (res?.error) {
      setMsg({ type: "err", text: res.error });
    } else {
      setMsg({ type: "ok", text: "Dip recorded." });
      form.reset();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
      <div className="sm:col-span-1">
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Tank</label>
        <select name="bulkTankId" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          {tanks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Measured litres</label>
        <input type="number" step="0.1" name="dipLitres" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Note</label>
        <input type="text" name="note" placeholder="optional" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <button type="submit" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Record dip"}
        </button>
        {msg && (
          <span className={`text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}
