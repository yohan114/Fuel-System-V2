"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveCorrectionAction, rejectCorrectionAction } from "@/app/actions/correction";
import { Check, X } from "lucide-react";

export default function CorrectionReviewActions({ correctionId }: { correctionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ error?: string; success?: boolean }>) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Review note (optional)"
        className="bg-[#1b1e30] border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white placeholder-gray-600 w-44 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          disabled={isPending}
          onClick={() => run(() => approveCorrectionAction(correctionId, note || null))}
          className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-[10px] px-3 py-1.5 rounded-lg"
        >
          <Check className="w-3 h-3" /> Approve
        </button>
        <button
          disabled={isPending}
          onClick={() => run(() => rejectCorrectionAction(correctionId, note || null))}
          className="inline-flex items-center gap-1 bg-white/5 hover:bg-red-500/10 hover:text-red-400 text-gray-400 font-semibold border border-white/10 text-[10px] px-3 py-1.5 rounded-lg"
        >
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
      {err && <span className="text-[10px] text-red-300">{err}</span>}
    </div>
  );
}
