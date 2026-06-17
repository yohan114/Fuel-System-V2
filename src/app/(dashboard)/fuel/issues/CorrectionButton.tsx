"use client";

import React, { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { submitCorrectionAction } from "@/app/actions/correction";
import { Wrench, X, AlertCircle, Upload } from "lucide-react";

interface IssueProp {
  id: string;
  assetCode: string;
  litres: number;
  meterReading: number | null;
  readingType: string | null;
  fuelKind: string;
  issueDateISO: string;
}

type State = { error?: string; success?: boolean } | null;

export default function CorrectionButton({ issue }: { issue: IssueProp }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"EDIT" | "VOID">("EDIT");
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => submitCorrectionAction(fd),
    null
  );

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const dt = new Date(issue.issueDateISO);
  const localDt = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const inputCls =
    "w-full bg-[#1b1e30] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500/50";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/10 rounded-lg px-2.5 py-1.5"
      >
        <Wrench className="w-3 h-3" /> Correct
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-white">Correct fuel issue · {issue.assetCode}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form action={formAction} className="p-5 space-y-4">
              <input type="hidden" name="fuelIssueId" value={issue.id} />
              <input type="hidden" name="type" value={type} />

              {/* Type toggle */}
              <div className="flex gap-2">
                {(["EDIT", "VOID"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 text-xs font-semibold rounded-lg py-2 border transition-all ${
                      type === t
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-white/5 border-white/10 text-gray-400 hover:text-white"
                    }`}
                  >
                    {t === "EDIT" ? "Fix values" : "Void (wrong/duplicate)"}
                  </button>
                ))}
              </div>

              {type === "EDIT" && (
                <div className="space-y-3">
                  <p className="text-[10px] text-gray-500">Only change the fields that are wrong.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 font-semibold uppercase">Litres</label>
                      <input name="newLitres" type="number" step="0.01" defaultValue={issue.litres} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-semibold uppercase">Meter ({issue.readingType || "—"})</label>
                      <input name="newMeterReading" type="number" step="0.01" defaultValue={issue.meterReading ?? ""} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-semibold uppercase">Fuel type</label>
                      <select name="newFuelKind" defaultValue={issue.fuelKind} className={inputCls}>
                        <option value="AUTO_DIESEL">Auto Diesel</option>
                        <option value="SUPER_DIESEL">Super Diesel</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-semibold uppercase">Issue date</label>
                      <input name="newIssueDate" type="datetime-local" defaultValue={localDt} className={inputCls} />
                    </div>
                  </div>
                </div>
              )}

              {type === "VOID" && (
                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/10 rounded-lg p-3">
                  This will cancel the issue (a duplicate or wrong entry). It stays on record but is
                  excluded from billing, fuel totals and reports once an admin approves.
                </p>
              )}

              <div>
                <label className="text-[10px] text-gray-500 font-semibold uppercase">Reason</label>
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder="What is wrong and the correct value…"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="text-[10px] text-gray-500 font-semibold uppercase flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Signed running-chart document (required)
                </label>
                <input
                  name="document"
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  className="mt-1 w-full text-[11px] text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-white file:text-xs"
                />
                <p className="text-[10px] text-gray-600 mt-1">Photo or PDF, up to 10 MB.</p>
              </div>

              {state?.error && (
                <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/10 rounded-lg p-3">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{state.error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={pending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl py-2.5 active:scale-95 transition-all"
              >
                {pending ? "Submitting…" : "Submit for admin approval"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
