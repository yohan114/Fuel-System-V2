"use client";

import React, { useState } from "react";
import { updateProductAction } from "@/app/actions/inventory";

// Inline-editable reorder level (auto-saves on blur / Enter as an audited
// product update). Mirrors the Filter Stock inline-edit pattern.
export default function ReorderInput({ id, value }: { id: string; value: number | null }) {
  const [val, setVal] = useState(value == null ? "" : String(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "err">("idle");

  async function save() {
    if ((value == null ? "" : String(value)) === val) return;
    setState("saving");
    const fd = new FormData();
    fd.set("id", id);
    fd.set("reorderLevel", val);
    const res = await updateProductAction(fd);
    setState(res?.error ? "err" : "saved");
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        step="0.01"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-20 bg-[#1b1e30] border border-white/5 rounded-lg px-2 py-1 text-white text-xs text-right"
      />
      {state === "saving" && <span className="text-[9px] text-gray-500">…</span>}
      {state === "saved" && <span className="text-[9px] text-emerald-400">✓</span>}
      {state === "err" && <span className="text-[9px] text-red-400">!</span>}
    </span>
  );
}
