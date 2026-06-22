"use client";

import React, { useState } from "react";
import { addBatteryAction } from "@/app/actions/battery";

// Register a battery with a mandatory photo (camera capture supported on phones).
export default function BatteryForm() {
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setMsg(null);
    const res = await addBatteryAction(new FormData(form));
    setPending(false);
    if (res?.error) setMsg({ type: "err", text: res.error });
    else { setMsg({ type: "ok", text: "Battery registered." }); form.reset(); }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Vehicle no.</label>
        <input type="text" name="vehicleNo" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs uppercase" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Serial no.</label>
        <input type="text" name="serialNo" required className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs uppercase" />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Photo</label>
        <input type="file" name="photo" accept="image/*" capture="environment" required className="w-full text-gray-300 text-[10px] file:bg-white/5 file:border-0 file:text-gray-300 file:rounded-lg file:px-2 file:py-1 file:mr-2" />
      </div>
      <div className="flex flex-col gap-1">
        <input type="text" name="note" placeholder="note (optional)" className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs mb-1" />
        <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl px-4 py-2.5">
          {pending ? "Saving…" : "Register"}
        </button>
        {msg && <span className={`text-[10px] ${msg.type === "err" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
