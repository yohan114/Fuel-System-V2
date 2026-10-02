import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ArrowLeft, FileText, CheckCircle2, XCircle, Clock, ShieldCheck, User, Fuel, AlertTriangle, ExternalLink } from "lucide-react";
import CorrectionReviewActions from "../CorrectionReviewActions";

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_STYLE: Record<string, { badge: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDING: { badge: "bg-amber-500/10 border-amber-500/20 text-amber-400", icon: Clock },
  APPROVED: { badge: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
  REJECTED: { badge: "bg-rose-500/10 border-rose-500/20 text-rose-400", icon: XCircle },
};

export default async function CorrectionDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const { id } = await props.params;

  const correction = await prisma.fuelIssueCorrection.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
      fuelIssue: {
        select: {
          id: true,
          issueDate: true,
          litres: true,
          fuelKind: true,
          meterReading: true,
          totalCost: true,
          voided: true,
        },
      },
    },
  });

  if (!correction) notFound();

  const isAdmin = session.role === "ADMIN";
  // Non-admins can only see corrections they requested
  if (!isAdmin && correction.requestedById !== session.userId) {
    notFound();
  }

  const StatusIcon = STATUS_STYLE[correction.status]?.icon || Clock;
  const isImage = correction.docMime.startsWith("image/");
  const isPdf = correction.docMime === "application/pdf";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Back Link */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/fuel/corrections" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Fuel Corrections
            </Link>
            <span>/</span>
            <span className="text-white font-mono">{correction.assetCode}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white tracking-wide">
              Correction Request: {correction.assetCode}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                STATUS_STYLE[correction.status]?.badge
              }`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              {correction.status}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            Requested on {new Date(correction.createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })} by {correction.requestedBy.name}
          </p>
        </div>

        {isAdmin && correction.status === "PENDING" && (
          <CorrectionReviewActions correctionId={correction.id} />
        )}
      </div>

      {/* Main Grid: Details + Document Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Metadata & Diff */}
        <div className="space-y-6">
          {/* Metadata Card */}
          <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-white/5 pb-2">
              Request Details
            </h3>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500 block">Machine / Asset</span>
                <Link
                  href={`/fleet/${correction.assetCode}`}
                  className="font-bold text-indigo-400 hover:text-indigo-300 text-sm block mt-0.5"
                >
                  {correction.assetCode}
                </Link>
              </div>

              <div>
                <span className="text-gray-500 block">Project / Site</span>
                <span className="font-semibold text-white block mt-0.5">
                  {correction.projectName || correction.projectCode || "Unassigned"}
                </span>
              </div>

              <div>
                <span className="text-gray-500 block">Correction Type</span>
                <span className={`inline-block px-2 py-0.5 mt-0.5 rounded text-[11px] font-bold border ${
                  correction.type === "VOID"
                    ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                    : "bg-white/5 border-white/10 text-gray-200"
                }`}>
                  {correction.type}
                </span>
              </div>

              <div>
                <span className="text-gray-500 block">Original Issue</span>
                <Link
                  href={`/fuel/issues/${correction.fuelIssueId}`}
                  className="font-semibold text-indigo-400 hover:text-indigo-300 block mt-0.5"
                >
                  View Fuel Issue →
                </Link>
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-500 block">Reason for Adjustment</span>
              <p className="text-xs text-gray-200 mt-1 bg-white/5 p-3 rounded-xl border border-white/5 italic">
                “{correction.reason}”
              </p>
            </div>

            {/* Review Status Info */}
            {correction.status !== "PENDING" && (
              <div className="pt-4 border-t border-white/5 space-y-2">
                <span className="text-xs font-semibold text-gray-400 block">Review History</span>
                <div className="text-xs text-gray-300 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Reviewed by: {correction.reviewedBy?.name || "System Administrator"}</span>
                  </div>
                  {correction.reviewedAt && (
                    <div className="text-gray-500 text-[11px]">
                      Reviewed at: {new Date(correction.reviewedAt).toLocaleString("en-GB")}
                    </div>
                  )}
                  {correction.reviewNote && (
                    <div className="p-2.5 rounded-lg bg-white/5 text-xs text-gray-300 mt-1">
                      Note: {correction.reviewNote}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Change Comparison (Diff Table) */}
          <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-white/5 pb-2">
              Value Changes
            </h3>

            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-gray-500 uppercase border-b border-white/5">
                <tr>
                  <th className="py-2">Field</th>
                  <th className="py-2">Original</th>
                  <th className="py-2">Proposed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr>
                  <td className="py-2.5 font-semibold text-gray-400">Litres</td>
                  <td className="py-2.5 text-gray-300">{correction.origLitres} L</td>
                  <td className="py-2.5 font-bold text-white">
                    {correction.type === "VOID" ? (
                      <span className="text-rose-400">0 L (Void)</span>
                    ) : correction.newLitres != null ? (
                      <span className="text-emerald-400">{correction.newLitres} L</span>
                    ) : (
                      <span className="text-gray-500">Unchanged</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-semibold text-gray-400">Meter Reading</td>
                  <td className="py-2.5 text-gray-300">{correction.origMeterReading ?? "—"}</td>
                  <td className="py-2.5 font-bold text-white">
                    {correction.newMeterReading != null ? (
                      <span className="text-emerald-400">{correction.newMeterReading}</span>
                    ) : (
                      <span className="text-gray-500">Unchanged</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-semibold text-gray-400">Fuel Kind</td>
                  <td className="py-2.5 text-gray-300">{correction.origFuelKind}</td>
                  <td className="py-2.5 font-bold text-white">
                    {correction.newFuelKind ? (
                      <span className="text-emerald-400">{correction.newFuelKind}</span>
                    ) : (
                      <span className="text-gray-500">Unchanged</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-semibold text-gray-400">Issue Date</td>
                  <td className="py-2.5 text-gray-300">
                    {new Date(correction.origIssueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="py-2.5 font-bold text-white">
                    {correction.newIssueDate ? (
                      <span className="text-emerald-400">
                        {new Date(correction.newIssueDate).toLocaleDateString("en-GB")}
                      </span>
                    ) : (
                      <span className="text-gray-500">Unchanged</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Evidence Document Viewer */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 flex flex-col space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Evidence Document
              </h3>
              <span className="text-[11px] text-gray-500">{correction.docName}</span>
            </div>
            <a
              href={`/api/corrections/${correction.id}/document`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Full View
            </a>
          </div>

          <div className="flex-1 min-h-[400px] bg-[#0c0d15] border border-white/5 rounded-xl overflow-hidden flex items-center justify-center p-2">
            {isImage ? (
              <img
                src={`/api/corrections/${correction.id}/document`}
                alt={correction.docName}
                className="max-h-[500px] w-auto max-w-full object-contain rounded-lg shadow-lg"
              />
            ) : isPdf ? (
              <iframe
                src={`/api/corrections/${correction.id}/document`}
                className="w-full h-full min-h-[500px] rounded-lg border-0"
                title={correction.docName}
              />
            ) : (
              <div className="text-center p-8 space-y-3">
                <FileText className="w-12 h-12 text-gray-600 mx-auto" />
                <p className="text-xs text-gray-400">
                  Document type: {correction.docMime}
                </p>
                <a
                  href={`/api/corrections/${correction.id}/document`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
                >
                  Download / View Document
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
