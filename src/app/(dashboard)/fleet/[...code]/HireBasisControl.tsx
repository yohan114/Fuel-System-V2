"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Droplet, DropletOff } from "lucide-react";
import { setVehicleBasisAction } from "@/app/actions/billing";

const OPTIONS = [
  { code: "d", label: "Dry", hint: "rental only · no fuel" },
  { code: "w", label: "Wet", hint: "rental + fuel" },
  { code: "fw", label: "Fully Wet", hint: "incl. fuel in rate" },
];

export default function HireBasisControl({ assetId, current }: { assetId: string; current: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [applyDrafts, setApplyDrafts] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sel = current || "w";

  function set(basis: string) {
    if (basis === current && !msg) return;
    setMsg(null);
    startTransition(async () => {
      const res = await setVehicleBasisAction(assetId, basis, applyDrafts);
      if ((res as any).error) setMsg({ ok: false, text: (res as any).error });
      else {
        const r = res as any;
        setMsg({ ok: true, text: `Default set to ${OPTIONS.find((o) => o.code === basis)?.label}${r.regenerated ? ` · re-costed ${r.regenerated} draft(s)` : ""}.` });
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
        {sel === "d" ? <DropletOff className="w-4 h-4 text-amber-400" /> : <Droplet className="w-4 h-4 text-sky-400" />} Hire Basis
      </h3>
      <p className="text-[11px] text-gray-500 mb-4">Default basis new bills use for this vehicle. Dry = rental only (customer self-fuels); Wet = rental + the vehicle&apos;s fuel total.</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.code}
            onClick={() => set(o.code)}
            disabled={pending}
            className={`flex-1 min-w-24 rounded-xl border px-3 py-2.5 text-left transition-all disabled:opacity-50 ${
              sel === o.code
                ? o.code === "d" ? "border-amber-500/40 bg-amber-500/10" : "border-sky-500/40 bg-sky-500/10"
                : "border-white/10 bg-white/[0.02] hover:bg-white/5"
            }`}
          >
            <span className={`block text-sm font-bold ${sel === o.code ? (o.code === "d" ? "text-amber-300" : "text-sky-300") : "text-gray-300"}`}>{o.label}</span>
            <span className="block text-[10px] text-gray-500">{o.hint}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-gray-400 mt-3 select-none">
        <input type="checkbox" checked={applyDrafts} onChange={(e) => setApplyDrafts(e.target.checked)} className="accent-amber-500" />
        Also re-cost this vehicle&apos;s open draft bills now
        {pending && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </label>
      {msg && <p className={`text-[11px] mt-2 ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>}
    </div>
  );
}
