"use client";

import React from "react";
import { addFilterPriceAction } from "@/app/actions/price";

// Inline price-book entry: pre-filled with the average paid; saves on Save/Enter.
export default function PriceInput({ supplierCode, description, suggested }: { supplierCode: string; description: string | null; suggested: number | null }) {
  return (
    <form action={addFilterPriceAction} className="inline-flex items-center gap-1 justify-end">
      <input type="hidden" name="supplierCode" value={supplierCode} />
      <input type="hidden" name="description" value={description ?? ""} />
      <span className="text-gray-500 text-[10px]">Rs.</span>
      <input
        name="unitPrice"
        type="number"
        min={0}
        step="0.01"
        defaultValue={suggested != null ? (suggested / 100).toFixed(2) : ""}
        placeholder="0.00"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        className="w-24 bg-[#1b1e30] border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-indigo-500/50"
      />
      <button type="submit" className="text-[10px] bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 rounded px-2 py-1 font-semibold">Save</button>
    </form>
  );
}
