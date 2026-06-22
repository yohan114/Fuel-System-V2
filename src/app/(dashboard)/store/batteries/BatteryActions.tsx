"use client";

import React, { useState } from "react";
import { transferBatteryAction, decommissionBatteryAction } from "@/app/actions/battery";

export default function BatteryActions({ id }: { id: string }) {
  const [open, setOpen] = useState<null | "transfer">(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newVehicleNo, setNewVehicleNo] = useState("");

  async function transfer() {
    if (!newVehicleNo.trim()) return;
    setPending(true); setErr(null);
    const fd = new FormData();
    fd.set("id", id); fd.set("newVehicleNo", newVehicleNo);
    const res = await transferBatteryAction(fd);
    setPending(false);
    if (res?.error) setErr(res.error); else { setOpen(null); setNewVehicleNo(""); }
  }

  async function decommission() {
    const reason = prompt("Decommission this battery? Optionally give a reason:");
    if (reason === null) return;
    setPending(true); setErr(null);
    const fd = new FormData();
    fd.set("id", id); fd.set("reason", reason);
    const res = await decommissionBatteryAction(fd);
    setPending(false);
    if (res?.error) setErr(res.error);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open === "transfer" ? (
        <>
          <input value={newVehicleNo} onChange={(e) => setNewVehicleNo(e.target.value)} placeholder="new vehicle no." className="w-32 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1 text-white text-xs uppercase" />
          <button disabled={pending} onClick={transfer} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-2.5 py-1">Save</button>
          <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-white text-xs">×</button>
        </>
      ) : (
        <>
          <button disabled={pending} onClick={() => setOpen("transfer")} className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold">Transfer</button>
          <button disabled={pending} onClick={decommission} className="text-rose-400 hover:text-rose-300 text-xs font-semibold">Decommission</button>
        </>
      )}
      {err && <span className="text-[9px] text-red-400">{err}</span>}
    </div>
  );
}
