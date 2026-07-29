import React from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getTankReconciliation } from "@/lib/integrity/tank";
import { Droplets, AlertTriangle, PlusCircle } from "lucide-react";
import TankDipForm from "./TankDipForm";

function L(n: number) {
  return `${n.toLocaleString("en-LK", { maximumFractionDigits: 1 })} L`;
}

export default async function TanksPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const [tanks, replenishments] = await Promise.all([
    getTankReconciliation(),
    // Replenishments no longer pass through an approval queue, so this log is
    // the admin's visibility into who put fuel into which tank and when.
    prisma.bulkRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        bulkTank: { select: { name: true } },
        sourceTank: { select: { name: true } },
        requestedBy: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Droplets className="w-5 h-5 text-indigo-400" /> Bulk-Tank Reconciliation
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Compare the system balance against a physical dip. A persistent shortfall flags shrinkage or unrecorded draws.
        </p>
      </div>

      {/* Record a dip */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Record a Physical Dip</h3>
        <TankDipForm tanks={tanks.map((t) => ({ id: t.id, name: t.name }))} />
      </div>

      {/* Reconciliation table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2">Tanks</h3>
        {tanks.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No bulk tanks configured.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Tank</th>
                <th className="py-2.5">Fuel</th>
                <th className="py-2.5 text-right">System Balance</th>
                <th className="py-2.5 text-right">Capacity</th>
                <th className="py-2.5 text-right">Last Dip</th>
                <th className="py-2.5 text-right">Variance</th>
                <th className="py-2.5">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tanks.map((t) => {
                const shortfall = t.currentVariance != null && t.currentVariance < -Math.max(t.capacity * 0.02, 5);
                return (
                  <tr key={t.id} className="hover:bg-white/[0.01]">
                    <td className="py-3 font-bold text-white">{t.name}</td>
                    <td className="py-3 text-gray-400 capitalize">{t.fuelKind.replace("_", " ").toLowerCase()}</td>
                    <td className="py-3 text-right text-white font-semibold">{L(t.balance)}</td>
                    <td className="py-3 text-right text-gray-400">{L(t.capacity)}</td>
                    <td className="py-3 text-right text-gray-300">
                      {t.lastDip ? (
                        <span title={new Date(t.lastDip.dipDate).toLocaleString()}>{L(t.lastDip.dipLitres)}</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className={`py-3 text-right font-bold ${t.currentVariance == null ? "text-gray-600" : t.currentVariance < 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {t.currentVariance != null ? `${t.currentVariance > 0 ? "+" : ""}${L(t.currentVariance)}` : "—"}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {t.lowBalance && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/15">LOW</span>
                        )}
                        {shortfall && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-400 border border-red-500/15 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> SHORTFALL
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Replenishment log — replaces the old approval queue */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-indigo-400" /> Recent Replenishments
        </h3>
        <p className="text-[11px] text-gray-500 mb-4 border-b border-white/5 pb-3">
          Replenishments apply immediately without approval. Every one is logged here
          and in the <a href="/admin/audit?action=REPLENISH" className="text-indigo-400 hover:underline">audit log</a>.
          Check these against the dip variance above.
        </p>
        {replenishments.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No replenishments recorded yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">When</th>
                <th className="py-2.5">Tank</th>
                <th className="py-2.5 text-right">Litres</th>
                <th className="py-2.5">Source</th>
                <th className="py-2.5">Recorded by</th>
                <th className="py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {replenishments.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-gray-400 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-3 font-bold text-white">{r.bulkTank.name}</td>
                  <td className="py-3 text-right text-white font-semibold">{L(r.requestedLitres)}</td>
                  <td className="py-3 text-gray-400">
                    {r.sourceType === "SITE"
                      ? `Transfer from ${r.sourceTank?.name ?? "another site"}`
                      : "Outside purchase"}
                  </td>
                  <td className="py-3 text-gray-300">{r.requestedBy.name}</td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        r.status === "APPROVED"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : r.status === "REJECTED"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {r.status === "APPROVED" ? "APPLIED" : r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
