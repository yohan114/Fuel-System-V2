import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Droplets, ArrowRightLeft, Truck, AlertTriangle, CheckCircle2, Clock, XCircle, ArrowLeft } from "lucide-react";
import { RequestBulkModal, BulkRequestItemActions } from "./BulkActions";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function BulkFuelPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const searchParams = await props.searchParams;
  const statusFilter = searchParams.status || "ALL";

  const [tanks, bulkRequests, dips] = await Promise.all([
    prisma.bulkTank.findMany({
      orderBy: { name: "asc" },
      include: {
        dips: {
          orderBy: { dipDate: "desc" },
          take: 1,
        },
      },
    }),
    prisma.bulkRequest.findMany({
      where: statusFilter !== "ALL" ? { status: statusFilter } : undefined,
      include: {
        bulkTank: true,
        sourceTank: true,
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.tankDip.findMany({
      include: {
        bulkTank: true,
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { dipDate: "desc" },
      take: 20,
    }),
  ]);

  const totalFuelLitres = tanks.reduce((s, t) => s + t.balance, 0);
  const totalCapacityLitres = tanks.reduce((s, t) => s + t.capacity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/fuel/issues" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Fuel Logs
            </Link>
            <span>/</span>
            <span className="text-white font-medium">Bulk Storage & Transfers</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Droplets className="w-5 h-5 text-indigo-400" /> Bulk Tanks & Bowser Transfers
          </h1>
          <p className="text-xs text-gray-400">
            Monitor physical site tanks, record deliveries, and approve inter-site bowser transfers.
          </p>
        </div>

        <RequestBulkModal tanks={tanks} />
      </div>

      {/* Tank Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tanks.map((tank) => {
          const pct = Math.min(100, Math.max(0, (tank.balance / tank.capacity) * 100));
          const isLow = pct < 20;
          const lastDip = tank.dips[0];
          return (
            <div
              key={tank.id}
              className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-white text-base">{tank.name}</h3>
                  <span className="text-[11px] text-gray-400 capitalize">
                    {tank.fuelKind.replace("_", " ").toLowerCase()}
                  </span>
                </div>
                {isLow ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> LOW
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    NORMAL
                  </span>
                )}
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-2xl font-black text-white">
                    {tank.balance.toLocaleString("en-LK", { maximumFractionDigits: 0 })} L
                  </span>
                  <span className="text-xs text-gray-500">
                    of {tank.capacity.toLocaleString("en-LK")} L ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isLow ? "bg-amber-500" : pct > 85 ? "bg-indigo-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-gray-400">
                <span>Last Dip:</span>
                <span className="text-gray-300 font-medium">
                  {lastDip ? (
                    `${lastDip.dipLitres.toLocaleString("en-LK")} L (${new Date(
                      lastDip.dipDate
                    ).toLocaleDateString("en-GB")})`
                  ) : (
                    "None"
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transfer & Delivery Requests Table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl space-y-4 p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              Transfer & Bulk Refill Requests
            </h3>
            <p className="text-[11px] text-gray-400">
              Audit log of supplier deliveries and inter-site fuel dispatches.
            </p>
          </div>

          <div className="flex gap-1.5">
            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((st) => (
              <Link
                key={st}
                href={`/fuel/bulk?status=${st}`}
                className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                  statusFilter === st
                    ? "bg-indigo-600 text-white"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {st}
              </Link>
            ))}
          </div>
        </div>

        {bulkRequests.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500">
            No bulk requests found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Target Tank</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold text-right">Volume</th>
                  <th className="px-4 py-3 font-semibold">Requested By</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {isAdmin && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {bulkRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white whitespace-nowrap">
                      {new Date(req.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-white/5 border border-white/10 text-gray-300">
                        {req.sourceType === "SITE" ? (
                          <>
                            <ArrowRightLeft className="w-3 h-3 text-indigo-400" /> Transfer
                          </>
                        ) : (
                          <>
                            <Truck className="w-3 h-3 text-emerald-400" /> Delivery
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">
                      {req.bulkTank.name}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {req.sourceType === "SITE" && req.sourceTank ? (
                        <span>{req.sourceTank.name}</span>
                      ) : (
                        <span className="text-gray-500 italic">Outside Supplier</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-white text-right whitespace-nowrap">
                      {req.requestedLitres.toLocaleString("en-LK")} L
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {req.requestedBy.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                          req.status === "APPROVED"
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : req.status === "REJECTED"
                            ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                            : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        }`}
                      >
                        {req.status}
                      </span>
                      {req.reviewNote && (
                        <span className="block text-[10px] text-gray-500 mt-0.5 truncate max-w-xs">
                          {req.reviewNote}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        {req.status === "PENDING" ? (
                          <BulkRequestItemActions requestId={req.id} />
                        ) : (
                          <span className="text-[10px] text-gray-600">
                            {req.reviewedBy?.name ? `by ${req.reviewedBy.name}` : "—"}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
