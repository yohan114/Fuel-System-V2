import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import { approveRequestAction, rejectRequestAction } from "@/app/actions/fuel";
import Link from "next/link";
import { FileClock, User, Check, X, FileText, Calendar, CornerDownRight, UserCheck } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function FuelRequestsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;
  const statusFilter = searchParams.status || "PENDING";
  const isAdmin = session.role === "ADMIN";

  // Build where query
  const where: any = {};
  if (statusFilter !== "ALL") {
    where.status = statusFilter;
  }

  const visible = await visibleAssetIdsForUser(session);
  if (visible) {
    where.assetId = { in: [...visible] };
  } else if (!isAdmin) {
    where.requestedById = session.userId;
  }

  const requests = await prisma.fuelRequest.findMany({
    where,
    omit: { photoData: true },
    include: {
      asset: true,
      requestedBy: true,
      reviewedBy: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">Fuel Requests</h1>
        <p className="text-xs text-gray-400 mt-1">
          {isAdmin 
            ? "Review and authorize fuel dispatches for fleet assets." 
            : "Monitor and submit new fuel requests for your assigned assets."
          }
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-white/5 bg-white/5 rounded-t-xl">
        {["PENDING", "APPROVED", "REJECTED", "ALL"].map((status) => {
          const isActive = statusFilter === status;
          return (
            <Link
              key={status}
              href={`/fuel/requests?status=${status}`}
              className={`px-5 py-4.5 text-xs font-semibold border-b-2 transition-all ${
                isActive
                  ? "border-indigo-500 text-white bg-[#090a0f]/50"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {status}
            </Link>
          );
        })}
      </div>

      {/* Requests Table / Card list */}
      {requests.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-b-2xl py-16 text-center text-xs text-gray-500">
          No requests found matching your selection.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-md transition-all hover:border-white/10"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Request details */}
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400 flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <Link 
                        href={`/fleet/${req.asset.code}`} 
                        className="font-bold text-white hover:text-indigo-400 text-sm tracking-wide"
                      >
                        {req.asset.code}
                      </Link>
                      <span className="text-gray-500 text-xs">•</span>
                      <span className="text-xs font-semibold text-white">
                        {req.requestedLitres} Litres of {req.fuelKind.replace("_", " ")}
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                        req.status === "APPROVED"
                          ? "bg-emerald-500/10 border border-emerald-500/10 text-emerald-400"
                          : req.status === "REJECTED"
                          ? "bg-red-500/10 border border-red-500/10 text-red-400"
                          : "bg-amber-500/10 border border-amber-500/10 text-amber-400"
                      }`}>
                        {req.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 mt-2 font-medium">
                      <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Requester: {req.requestedBy.name}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Created: {new Date(req.createdAt).toLocaleDateString()}</span>
                      {req.meterReading !== null && (
                        <>
                          <span>•</span>
                          <span className="font-mono">Meter: {req.meterReading.toLocaleString()} {req.readingType}</span>
                        </>
                      )}
                    </div>
                    
                    {req.reason && (
                      <p className="text-[11px] text-gray-400 bg-white/5 px-3 py-1.5 rounded-lg mt-3 w-fit">
                        Reason: {req.reason}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                  {req.status === "PENDING" && isAdmin ? (
                    <div className="flex items-center gap-2">
                      {/* Approve action */}
                      <form action={async (formData: FormData) => {
                        "use server";
                        const note = formData.get("reviewNote")?.toString() || "Approved";
                        await approveRequestAction(req.id, note);
                      }}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            name="reviewNote"
                            placeholder="Add approval note..."
                            className="bg-[#1b1e30] border border-white/5 rounded-lg px-2.5 py-1.5 text-[10px] text-white focus:outline-none placeholder-gray-600 w-32 md:w-40"
                          />
                          <button
                            type="submit"
                            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[10px] px-3 py-2 rounded-lg"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        </div>
                      </form>

                      {/* Reject action */}
                      <form action={async (formData: FormData) => {
                        "use server";
                        const note = formData.get("reviewNote")?.toString() || "Rejected";
                        await rejectRequestAction(req.id, note);
                      }}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="hidden"
                            name="reviewNote"
                            value="Rejected"
                          />
                          <button
                            type="submit"
                            className="flex items-center gap-1 bg-white/5 hover:bg-red-500/10 hover:text-red-400 text-gray-400 font-semibold border border-white/5 text-[10px] px-3 py-2 rounded-lg"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : req.status !== "PENDING" ? (
                    /* Review Details */
                    <div className="text-right text-[11px] text-gray-500">
                      <div className="flex items-center justify-end gap-1 font-semibold text-gray-400">
                        <UserCheck className="w-3.5 h-3.5 text-gray-500" />
                        <span>Reviewed by: {req.reviewedBy?.name || "System"}</span>
                      </div>
                      {req.reviewedAt && (
                        <p className="text-[10px] mt-0.5">
                          Date: {new Date(req.reviewedAt).toLocaleDateString()}
                        </p>
                      )}
                      {req.reviewNote && (
                        <p className="text-[10px] text-gray-400 mt-1 bg-white/5 px-2 py-0.5 rounded inline-block">
                          Note: {req.reviewNote}
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Pending User badge */
                    <span className="text-[10px] bg-amber-500/15 text-amber-300 px-3 py-1.5 rounded-lg font-bold">
                      AWAITING ADMIN REVIEW
                    </span>
                  )}
                </div>

              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
