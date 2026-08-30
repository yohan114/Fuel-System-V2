"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fuel, AlertTriangle, Check } from "lucide-react";
import { recordDirectIssueAction } from "@/app/actions/fuel";

// Recording a fuel issue against a pump the admin does not work at.
//
// The Pump Overview answers "what is in every tank"; this answers "put a litre
// out of THIS one". It exists because the office keys paper sheets for sites
// they never visit, and the only route in before was the site's own operator
// login.
//
// The whole design problem is that the admin cannot see the pump. An operator
// at Badalgama knows which tank they are standing next to; someone at a desk
// with thirty-two pumps on screen does not, and the estate is full of names
// that read alike — three Wadakada tanks, a "Marawila Tank" and a "Maravila
// road site", a "test Tank" holding 5,000 L. So the pump is named in the
// banner, again in the confirm step, and again in the button that commits it.
// Recording into the wrong site's tank moves stock and moves money: the litres
// come off that tank's balance and land on that site's fuel bill.

export interface LockedTank {
  id: string;
  name: string;
  fuelKind: string;
  balance: number;
  capacity: number;
  projectCode: string | null;
  projectName: string | null;
  isWorkshop: boolean;
}

export interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
}

interface Props {
  tank: LockedTank;
  assets: AssetOption[];
  /** Colombo "now", formatted for datetime-local, computed on the server so the
   *  first render cannot disagree with the client's clock. */
  nowLocal: string;
}

const BACKDATE_FREE_DAYS = 7;

export default function PumpIssuePanel({ tank, assets, nowLocal }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [assetRef, setAssetRef] = useState("");
  const [litres, setLitres] = useState("");
  const [meter, setMeter] = useState("");
  const [issueDate, setIssueDate] = useState(nowLocal);
  const [reason, setReason] = useState("");
  // Submit does not commit. An issue is as hard to undo as a bulk refuel — it
  // needs an admin void with a written reason — so it gets the same read-back
  // the refuel already has.
  const [confirming, setConfirming] = useState(false);

  const matched = useMemo(() => {
    const t = assetRef.trim().toUpperCase();
    if (!t) return null;
    return assets.find((a) => a.code.toUpperCase() === t || (a.regNo ?? "").toUpperCase() === t) ?? null;
  }, [assetRef, assets]);

  const litresNum = parseFloat(litres);
  const litresValid = Number.isFinite(litresNum) && litresNum > 0;
  const overBalance = litresValid && litresNum > tank.balance;

  const daysBack = useMemo(() => {
    if (!issueDate) return 0;
    const d = new Date(issueDate);
    if (Number.isNaN(d.getTime())) return 0;
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.max(0, Math.round((day(new Date()) - day(d)) / 86_400_000));
  }, [issueDate]);
  const needsReason = daysBack > BACKDATE_FREE_DAYS;

  const canReview = litresValid && !overBalance && assetRef.trim().length > 0 && (!needsReason || reason.trim().length >= 4);

  async function commit() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("assetId", assetRef.trim());
    // The pump decides the fuel kind — the tank is the fact. The action
    // re-checks this against the tank and refuses a mismatch.
    fd.set("fuelKind", tank.fuelKind);
    fd.set("litres", litres);
    if (meter.trim()) fd.set("meterReading", meter.trim());
    fd.set("issueDate", issueDate);
    // The pump this came out of. The action reads the tank from HERE, never
    // from the session — which is what makes recording for another site work.
    fd.set("bulkTankId", tank.id);
    if (reason.trim()) fd.set("backdateReason", reason.trim());

    const res = await recordDirectIssueAction(fd);
    setPending(false);
    setConfirming(false);
    if (res?.error) { setError(res.error); return; }
    setDone(res?.message ?? "Recorded.");
    setAssetRef(""); setLitres(""); setMeter(""); setReason("");
    router.refresh();
  }

  // Written out in full, not interpolated. Tailwind scans source text for class
  // names, so `bg-${accent}-500` produces no CSS at all and the bar renders
  // invisible — a fault that typechecks, builds, and only shows on screen.
  const barClass = tank.isWorkshop ? "bg-emerald-500" : "bg-indigo-500";
  const pct = tank.capacity > 0 ? Math.min(100, Math.max(0, (tank.balance / tank.capacity) * 100)) : 0;

  return (
    <div className="space-y-6">
      <Link href="/workshop" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
        <ArrowLeft size={14} /> Back to Pump Overview
      </Link>

      {/* The pump, stated once and unmissably. Never amber or red — this
          codebase already spends those on Low stock and on irreversibility. */}
      <div className={`rounded-2xl border p-5 ${
        tank.isWorkshop
          ? "border-emerald-500/20 bg-emerald-500/[0.06]"
          : "border-indigo-500/20 bg-indigo-500/[0.06]"
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">{tank.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`px-2 py-0.5 rounded-md border font-semibold uppercase tracking-wide ${
                tank.isWorkshop
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
              }`}>
                {tank.projectCode ?? "unassigned"}
                {tank.projectName ? ` · ${tank.projectName}` : ""}
              </span>
              <span className="text-gray-400 uppercase">{tank.fuelKind.replace(/_/g, " ")}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white tabular-nums">
              {tank.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })} L
            </div>
            <div className="text-[11px] text-gray-500">of {tank.capacity.toLocaleString()} L in this pump</div>
          </div>
        </div>
        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mt-4">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {done && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-300 flex items-start gap-2">
          <Check size={14} className="mt-0.5 shrink-0" />
          <span>{done}</span>
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Fuel size={14} className="text-indigo-400" /> Record a fuel issue
        </h2>

        {confirming ? (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-amber-300">Please check carefully</p>
            <dl className="text-xs divide-y divide-white/5 rounded-xl border border-white/5 overflow-hidden">
              {[
                ["Pump", tank.name],
                ["Site", `${tank.projectCode ?? "unassigned"}${tank.projectName ? ` · ${tank.projectName}` : ""}`],
                // Only show the plate when it differs from the code. Plenty of
                // machines here are registered under their own number, and
                // "31-0724 31-0724" reads as a bug in the confirm step.
                ["Vehicle", matched
                  ? `${matched.code}${matched.regNo && matched.regNo.toUpperCase() !== matched.code.toUpperCase() ? `  ${matched.regNo}` : ""}`
                  : `${assetRef.trim().toUpperCase()} — not on the register, it will be created`],
                ["Litres", `${litresNum} L ${tank.fuelKind.replace(/_/g, " ").toLowerCase()}`],
                ["Meter", meter.trim() ? `${meter.trim()} ${matched?.meterType ?? ""}` : "not recorded"],
                ["Date", issueDate.replace("T", " ")],
                ["Balance after", `${(tank.balance - litresNum).toFixed(1)} L`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 px-3 py-2 bg-white/[0.02]">
                  <dt className="w-28 shrink-0 text-gray-500">{k}</dt>
                  <dd className="text-gray-200">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 text-gray-300 hover:bg-white/10"
              >
                Go back &amp; edit
              </button>
              {/* The label restates the number AND the destination — the two
                  things that are expensive to get wrong. */}
              <button
                onClick={commit}
                disabled={pending}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
              >
                {pending ? "Recording…" : `Yes, record ${litresNum} L from ${tank.name}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Vehicle</label>
              <input
                list="pump-issue-assets"
                value={assetRef}
                onChange={(e) => setAssetRef(e.target.value)}
                placeholder="E&C number or plate, e.g. LB-22 / ZB-2587"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
              <datalist id="pump-issue-assets">
                {assets.map((a) => (
                  <option key={a.id} value={a.code}>{a.regNo ? `${a.regNo} · ` : ""}{a.meterType}</option>
                ))}
              </datalist>
              {assetRef.trim() && (
                <p className="mt-1 text-[10px] text-gray-500">
                  {matched
                    ? <>Matched <span className="text-gray-300 font-semibold">{matched.code}</span>{matched.regNo && matched.regNo.toUpperCase() !== matched.code.toUpperCase() ? ` (${matched.regNo})` : ""} · {matched.meterType} meter</>
                    : <span className="text-amber-400/80">Not on the register — recording will create it under &ldquo;Other Asset&rdquo;.</span>}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Litres</label>
              <input
                type="number" step="0.1" min="0" value={litres}
                onChange={(e) => setLitres(e.target.value)}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
              {overBalance && (
                <p className="mt-1 text-[10px] text-red-400">
                  {tank.name} holds {tank.balance.toFixed(1)} L — less than this.
                </p>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
                Meter reading <span className="text-gray-600 normal-case font-normal">(optional)</span>
              </label>
              <input
                type="number" step="1" min="0" value={meter}
                onChange={(e) => setMeter(e.target.value)}
                placeholder={matched ? `${matched.meterType} reading` : ""}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Date &amp; time</label>
              <input
                type="datetime-local" value={issueDate} max={nowLocal}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {needsReason && (
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1.5">
                  {daysBack} days back — why? (required)
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. keying the site's paper sheets for August"
                  className="w-full bg-[#1b1e30] border border-amber-500/30 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500/60"
                />
                <p className="mt-1 text-[10px] text-gray-500">It goes on the record with the issue.</p>
              </div>
            )}

            <div className="sm:col-span-2">
              <button
                onClick={() => setConfirming(true)}
                disabled={!canReview}
                className="w-full px-4 py-3 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              >
                Review &amp; record
              </button>
              <p className="mt-2 text-[10px] text-gray-500">
                These litres come off <span className="text-gray-300">{tank.name}</span> and land on that
                pump&apos;s site fuel bill. Undoing one needs an admin void with a written reason.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
