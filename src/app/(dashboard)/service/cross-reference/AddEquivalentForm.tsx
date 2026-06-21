"use client";

import React, { useState, useTransition } from "react";
import { addManualCrossRefAction } from "@/app/actions/xref";
import { Plus } from "lucide-react";

const inputCls = "bg-[#121420] border border-white/5 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500/40";

export default function AddEquivalentForm({ catalogId }: { catalogId: string }) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
        <Plus className="w-3 h-3" /> Add equivalent
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partNumber.trim()) return setError("Enter a part number");
    startTransition(async () => {
      const res = await addManualCrossRefAction({ catalogId, brand: brand.trim(), partNumber: partNumber.trim() });
      if (res?.error) setError(res.error);
      else {
        setBrand("");
        setPartNumber("");
        setOpen(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5 mt-1">
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand (optional)" className={inputCls} />
      <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="Part number" className={inputCls} />
      <button type="submit" disabled={isPending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10px] font-semibold rounded-lg px-3 py-1.5">
        {isPending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-white px-2">Cancel</button>
      {error && <span className="text-[10px] text-red-400 w-full">{error}</span>}
    </form>
  );
}
