"use client";

import React from "react";
import { setFilterStockAction } from "@/app/actions/stock";

// Inline on-hand editor: auto-saves on blur or Enter.
export default function StockInput({ normalizedCode, filterNo, onHand }: { normalizedCode: string; filterNo: string | null; onHand: number }) {
  return (
    <form action={setFilterStockAction} className="inline-flex">
      <input type="hidden" name="normalizedCode" value={normalizedCode} />
      <input type="hidden" name="filterNo" value={filterNo ?? ""} />
      <input
        name="onHand"
        type="number"
        min={0}
        defaultValue={onHand}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        className="w-16 bg-[#1b1e30] border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-indigo-500/50"
      />
    </form>
  );
}
