import React from "react";
import Link from "next/link";
import { Database, AlertTriangle, Warehouse } from "lucide-react";
import { fuelKindLabel } from "@/lib/fuel-kinds";

export interface TankTile {
  id: string;
  name: string;
  fuelKind: string;
  balance: number;
  capacity: number;
  siteId: string | null;
  siteCode: string | null;
  /** The central workshop pump, which may fuel any vehicle on any site. */
  isWorkshop: boolean;
  /** Litres issued from this tank in the current period. */
  issuedLitres: number;
}

function L(n: number) {
  return n.toLocaleString("en-LK", { maximumFractionDigits: 1 });
}

/**
 * Admin-only grid of every pump. Each tile links through to the Fuel Issue
 * Report already scoped to that tank's site, so "which site is burning fuel"
 * and "show me exactly which issues" are one click apart.
 *
 * This is rendered only for admins — the litre figures on these tiles are
 * precisely what operators must not see.
 */
export default function TankTiles({ tanks, from, to }: { tanks: TankTile[]; from: string; to: string }) {
  if (tanks.length === 0) {
    return (
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-8 text-center text-xs text-gray-500">
        No pumps configured.
      </div>
    );
  }

  const workshop = tanks.filter((t) => t.isWorkshop);
  const sites = tanks.filter((t) => !t.isWorkshop);

  const Tile = ({ t }: { t: TankTile }) => {
    const pct = t.capacity > 0 ? Math.min(100, Math.max(0, (t.balance / t.capacity) * 100)) : 0;
    const low = pct < 10;
    const href = t.siteId
      ? `/fuel/report?site=${t.siteId}&from=${from}&to=${to}`
      : `/fuel/report?from=${from}&to=${to}`;

    return (
      <Link
        href={href}
        className="group bg-[#121420] border border-white/5 hover:border-indigo-500/40 p-5 rounded-2xl shadow-lg space-y-3 transition-all hover:bg-white/[0.02] active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                t.isWorkshop ? "bg-emerald-500/10 text-emerald-400" : "bg-indigo-500/10 text-indigo-400"
              }`}
            >
              {t.isWorkshop ? <Warehouse className="w-4 h-4" /> : <Database className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <span className="text-white font-bold text-xs block truncate group-hover:text-indigo-300">{t.name}</span>
              <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider">
                {t.siteCode ?? "No site"} · {fuelKindLabel(t.fuelKind)}
              </span>
            </div>
          </div>
          {low && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-500/10 text-red-400 border border-red-500/15 flex items-center gap-1 flex-shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" /> LOW
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-lg font-bold text-white">{L(t.balance)} L</span>
            <span className="text-[9px] text-gray-500 font-semibold">of {L(t.capacity)} L</span>
          </div>
          <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden border border-white/5">
            <div
              className={`h-full rounded-full transition-all ${
                low ? "bg-red-500/70" : t.isWorkshop ? "bg-emerald-500/70" : "bg-indigo-500/70"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-500 font-semibold">
            <span>{pct.toFixed(0)}% full</span>
            <span>{L(t.issuedLitres)} L issued</span>
          </div>
        </div>

        <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider block pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          View fuel issues →
        </span>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      {workshop.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-emerald-400" /> Main Workshop Pump
            <span className="text-[9px] font-semibold text-gray-500 normal-case tracking-normal">
              — may fuel any vehicle on any site
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {workshop.map((t) => (
              <Tile key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-400" /> Site Pumps
          <span className="text-[9px] font-semibold text-gray-500 normal-case tracking-normal">
            — restricted to vehicles allocated to their own site
          </span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {sites.map((t) => (
            <Tile key={t.id} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
