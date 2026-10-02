import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { fuelDateTime } from "@/lib/colombo-date";
import { ArrowLeft, Check, X, Clock, User, Droplets, Gauge, ExternalLink, ShieldCheck, AlertCircle } from "lucide-react";
import { approveRequestAction, rejectRequestAction } from "@/app/actions/fuel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FuelRequestDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await props.params;

  const request = await prisma.fuelRequest.findUnique({
    where: { id },
    include: {
      asset: {
        include: {
          category: true,
          project: true,
        },
      },
      requestedBy: {
        select: { id: true, name: true, username: true, role: true },
      },
      reviewedBy: {
        select: { id: true, name: true, username: true, role: true },
      },
      issue: {
        select: { id: true, litres: true, totalCost: true, issueDate: true },
      },
    },
  });

  if (!request) notFound();

  const isAdmin = session.role === "ADMIN";
  const photoDataUri = request.photoData
    ? `data:${request.photoMime || "image/jpeg"};base64,${Buffer.from(request.photoData).toString("base64")}`
    : null;

  async function handleApprove(formData: FormData) {
    "use server";
    const note = formData.get("reviewNote")?.toString() || null;
    await approveRequestAction(id, note);
    redirect(`/fuel/requests/${id}`);
  }

  async function handleReject(formData: FormData) {
    "use server";
    const note = formData.get("reviewNote")?.toString() || null;
    await rejectRequestAction(id, note);
    redirect(`/fuel/requests/${id}`);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Breadcrumb */}
      <div>
        <Link
          href="/fuel/requests"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Fuel Requests</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Details (2 cols) */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                      request.status === "APPROVED"
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                        : request.status === "REJECTED"
                        ? "bg-red-500/20 border-red-500/40 text-red-300"
                        : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    }`}
                  >
                    {request.status}
                  </span>
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {request.fuelKind.replace("_", " ")}
                  </span>
                </div>

                <div className="text-3xl font-extrabold text-white font-mono mt-3">
                  {request.requestedLitres.toFixed(1)} <span className="text-lg font-normal text-slate-400">Litres</span>
                </div>
              </div>

              <div className="text-right">
                <Link
                  href={`/fleet/${request.asset.code}`}
                  className="inline-flex items-center gap-1.5 text-lg font-bold font-mono text-blue-400 hover:text-blue-300 hover:underline"
                >
                  <span>{request.asset.code}</span>
                  <ExternalLink className="w-4 h-4" />
                </Link>
                <div className="text-xs text-slate-400">
                  {request.asset.regNo || request.asset.category.name}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {request.asset.project?.name || "Global / Unassigned"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-800/80 text-xs">
              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Requested At
                </div>
                <div className="font-medium text-slate-200">
                  {fuelDateTime(request.createdAt)}
                </div>
              </div>

              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> Requested By
                </div>
                <div className="font-medium text-slate-200">
                  {request.requestedBy.name} ({request.requestedBy.role})
                </div>
              </div>

              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5" /> Meter Reading
                </div>
                <div className="font-medium text-slate-200 font-mono">
                  {request.meterReading !== null
                    ? `${request.meterReading} ${request.readingType || request.asset.meterType}`
                    : "Not recorded"}
                </div>
              </div>
            </div>

            {request.reason && (
              <div className="mt-4 pt-4 border-t border-slate-800 text-xs">
                <div className="text-slate-500 mb-1">Reason / Purpose:</div>
                <div className="text-slate-300 italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
                  &quot;{request.reason}&quot;
                </div>
              </div>
            )}
          </div>

          {/* Review Details / Action Panel */}
          {request.status !== "PENDING" ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 text-xs">
              <h3 className="font-semibold text-slate-400 uppercase tracking-wider">
                Review Decision
              </h3>
              <div className="text-slate-300">
                Reviewed by <span className="font-semibold text-white">{request.reviewedBy?.name || "Admin"}</span> on{" "}
                {request.reviewedAt ? fuelDateTime(request.reviewedAt) : "N/A"}.
              </div>
              {request.reviewNote && (
                <div className="text-slate-400 italic">
                  Note: &quot;{request.reviewNote}&quot;
                </div>
              )}
              {request.issue && (
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-emerald-400 font-medium">
                    Fuel Issued: {request.issue.litres} L
                  </span>
                  <Link
                    href={`/fuel/issues/${request.issue.id}`}
                    className="text-blue-400 hover:underline flex items-center gap-1"
                  >
                    <span>View Issue Record</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}
            </div>
          ) : isAdmin ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs">
              <h3 className="font-semibold text-white uppercase tracking-wider">
                Pending Administrator Review
              </h3>
              <p className="text-slate-400">
                Approving this request will immediately deduct {request.requestedLitres} L from the appropriate site pump and generate an official Fuel Issue record.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <form action={handleApprove} className="flex-1 space-y-2">
                  <input
                    type="text"
                    name="reviewNote"
                    placeholder="Approval note (optional)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span>Approve Request</span>
                  </button>
                </form>

                <form action={handleReject} className="flex-1 space-y-2">
                  <input
                    type="text"
                    name="reviewNote"
                    placeholder="Rejection reason..."
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 font-bold text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span>Reject Request</span>
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right Col: Attached Proof Photo */}
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Droplets className="w-4 h-4 text-amber-400" />
              <span>Pump / Meter Photo</span>
            </h3>

            {photoDataUri ? (
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[4/3] flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoDataUri}
                  alt={`Photo for request ${request.id}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="py-12 border border-dashed border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                No photo attached with this request.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
