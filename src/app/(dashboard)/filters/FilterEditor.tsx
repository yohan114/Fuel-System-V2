"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Loader2, X, Check } from "lucide-react";
import { createFilterAction, updateFilterAction } from "@/app/actions/filters";

export interface FilterEditValues {
  id: string;
  category: string | null;
  hifiPartNo: string | null;
  oemPartNo: string | null;
  description: string | null;
  priceCents: number | null;
  priceNote: string | null;
}

const inputCls = "bg-[#1b1e30] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-indigo-500/50 outline-none w-full";

export default function FilterEditor({ mode, filter }: { mode: "add" | "edit"; filter?: FilterEditValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function submit(fd: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = mode === "add" ? await createFilterAction(fd) : await updateFilterAction(filter!.id, fd);
      if (res?.error) setMsg(res.error);
      else { setOpen(false); router.refresh(); }
    });
  }

  if (!open) {
    return mode === "add" ? (
      <button onClick={() => setOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5 flex items-center gap-1.5">
        <Plus className="w-3.5 h-3.5" /> Add filter
      </button>
    ) : (
      <button onClick={() => setOpen(true)} className="text-gray-400 hover:text-indigo-400 p-1" title="Edit filter"><Pencil className="w-3.5 h-3.5" /></button>
    );
  }

  return (
    <div className={mode === "add" ? "bg-[#121420] border border-indigo-500/20 rounded-2xl p-4" : "mt-3 bg-white/[0.02] border border-white/10 rounded-xl p-3"}>
      <form action={submit} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <input name="category" defaultValue={filter?.category ?? ""} placeholder="Category" className={inputCls} />
        <input name="hifiPartNo" defaultValue={filter?.hifiPartNo ?? ""} placeholder="HIFI part no" className={inputCls} />
        <input name="oemPartNo" defaultValue={filter?.oemPartNo ?? ""} placeholder="OEM part no" className={inputCls} />
        <input name="description" defaultValue={filter?.description ?? ""} placeholder="Description" className={inputCls + " col-span-2 sm:col-span-1"} />
        <input name="price" type="number" step="0.01" min="0" defaultValue={filter?.priceCents != null ? (filter.priceCents / 100).toString() : ""} placeholder="Price (LKR)" className={inputCls} />
        <div className="col-span-2 sm:col-span-6 flex items-center gap-2">
          <input name="priceNote" defaultValue={filter?.priceNote ?? ""} placeholder="Price note (supplier)" className={inputCls + " flex-1"} />
          <button type="submit" disabled={pending} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 flex items-center gap-1 text-xs font-semibold">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
          </button>
          <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg px-3 py-1.5"><X className="w-3.5 h-3.5" /></button>
        </div>
        {msg && <p className="col-span-2 sm:col-span-6 text-[11px] text-rose-400">{msg}</p>}
      </form>
    </div>
  );
}
