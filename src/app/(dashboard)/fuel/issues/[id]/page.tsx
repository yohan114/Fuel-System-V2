import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { fuelDateTime } from "@/lib/colombo-date";
import { Fuel, ArrowLeft, Clock, User, Droplets, Gauge, AlertCircle, FileCheck, ExternalLink, ShieldAlert } from "lucide-react";
import IssueAdminActions from "../IssueAdminActions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FuelIssueDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await props.params;

  const [issue, auditLogs] = await Promise.all([
    prisma.fuelIssue.findUnique({
      where: { id },
      include: {
        asset: {
          include: {
            category: true,
            project: true,
            rentalRate: true,
          },
        },
        issuedBy: {
          select: { id: true, name: true, username: true, role: true },
        },
        bulkTank: true,
        fuelPrice: true,
        linkedRequest: true,
        meterReadingRecord: true,
        corrections: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: { entity: "FuelIssue", entityId: id },
      orderBy: { createdAt: "asc" },
      include: {
        actor: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  if (!issue) notFound();

  const isAdmin = session.role === "ADMIN";
  const hasPhoto = Boolean(issue.photoName || issue.photoData);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Breadcrumb & Nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/fuel/issues"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Fuel Issues</span>
        </Link>

        {isAdmin && (
          <IssueAdminActions
            issue={{
              id: issue.id,
              assetCode: issue.asset.code,
              litres: issue.litres,
              fuelKind: issue.fuelKind,
              meterReading: issue.meterReading,
              source: issue.source,
              issueDate: issue.issueDate.toISOString(),
              voided: issue.voided,
              bulkTankName: issue.bulkTank?.name ?? null,
              tankLocked: issue.bulkTankId != null,
            }}
            historyCount={auditLogs.length}
          />
        )}
      </div>

      {/* Void Alert Banner */}
      {issue.voided && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/80 text-red-200 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-sm">This Fuel Issue is VOIDED</div>
            <div className="text-xs text-red-300/80 mt-0.5">
              Voided on {issue.voidedAt ? fuelDateTime(issue.voidedAt) : "N/A"}. This dispense is excluded from fleet consumption, billing calculations, and financial rollups.
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Details + Photo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Issue Specs & Breakdown */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {issue.fuelKind.replace("_", " ")}
                </span>
                <div className="text-3xl font-extrabold text-white font-mono mt-2">
                  {issue.litres.toFixed(1)} <span className="text-lg font-normal text-slate-400">Litres</span>
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  Rs. {(issue.totalCost / 100).toLocaleString()} total @ Rs. {(issue.pricePerLitre / 100).toFixed(2)}/L
                </div>
              </div>

              <div className="text-right">
                <Link
                  href={`/fleet/${issue.asset.code}`}
                  className="inline-flex items-center gap-1.5 text-lg font-bold font-mono text-blue-400 hover:text-blue-300 hover:underline"
                >
                  <span>{issue.asset.code}</span>
                  <ExternalLink className="w-4 h-4" />
                </Link>
                <div className="text-xs text-slate-400">
                  {issue.asset.regNo || issue.asset.category.name}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {issue.asset.project?.name || "Global / Unassigned"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80 text-xs">
              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Date & Time
                </div>
                <div className="font-medium text-slate-200">
                  {fuelDateTime(issue.issueDate)}
                </div>
              </div>

              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5" /> Source / Pump
                </div>
                <div className="font-medium text-slate-200">
                  {issue.bulkTank?.name || issue.source}
                </div>
              </div>

              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5" /> Meter Reading
                </div>
                <div className="font-medium text-slate-200 font-mono">
                  {issue.meterReading !== null
                    ? `${issue.meterReading} ${issue.readingType || issue.asset.meterType}`
                    : "No reading logged"}
                </div>
              </div>

              <div>
                <div className="text-slate-500 mb-0.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> Dispensed By
                </div>
                <div className="font-medium text-slate-200">
                  {issue.issuePerson || issue.issuedBy.name}
                </div>
              </div>
            </div>
          </div>

          {/* Linked Request or Meter Reading Info */}
          {(issue.linkedRequest || issue.meterReadingRecord) && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Connected Operations
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {issue.linkedRequest && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <div className="text-slate-400 font-medium mb-1 flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-emerald-400" />
                      <span>Approved Fuel Request</span>
                    </div>
                    <div className="text-slate-300">
                      Requested {issue.linkedRequest.requestedLitres} L • Status: <span className="font-semibold text-emerald-400">{issue.linkedRequest.status}</span>
                    </div>
                    {issue.linkedRequest.reason && (
                      <div className="text-slate-400 text-[11px] mt-1 italic">
                        &quot;{issue.linkedRequest.reason}&quot;
                      </div>
                    )}
                  </div>
                )}

                {issue.meterReadingRecord && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <div className="text-slate-400 font-medium mb-1 flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-blue-400" />
                      <span>Linked Meter Reading</span>
                    </div>
                    <div className="font-mono text-slate-300">
                      {issue.meterReadingRecord.value} {issue.meterReadingRecord.readingType}
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      Source: {issue.meterReadingRecord.source}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Full Audit Trail */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>Full Audit Trail ({auditLogs.length} events)</span>
            </h3>

            {auditLogs.length === 0 ? (
              <div className="text-xs text-slate-500 py-3">
                No administrative changes recorded for this issue.
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 border-l border-slate-800">
                {auditLogs.map((log) => (
                  <div key={log.id} className="relative group text-xs">
                    <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-slate-800 border-2 border-slate-700 group-hover:border-blue-500 transition-colors" />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-200">
                        {log.action} • {log.actor?.name || "System"}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {fuelDateTime(log.createdAt)}
                      </span>
                    </div>
                    <div className="text-slate-400 mt-1">{log.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Running Chart / Pump Photo Proof */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Fuel className="w-4 h-4 text-blue-400" />
              <span>Running Chart Photo</span>
            </h3>

            {hasPhoto ? (
              <div className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[4/3] flex items-center justify-center relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/v1/fuel/issues/${issue.id}/photo`}
                    alt={`Photo proof for ${issue.asset.code}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <a
                    href={`/api/v1/fuel/issues/${issue.id}/photo`}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-semibold text-xs backdrop-blur-xs transition-opacity"
                  >
                    Click to Open Full Res
                  </a>
                </div>
                <div className="text-[11px] text-slate-500 text-center">
                  Attached at issue creation
                </div>
              </div>
            ) : (
              <div className="py-12 border border-dashed border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                No photo was attached for this fuel issue.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
