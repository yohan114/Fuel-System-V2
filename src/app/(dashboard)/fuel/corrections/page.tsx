import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import CorrectionReviewActions from "./CorrectionReviewActions";
import { Wrench, FileText, Building2, User, ShieldCheck } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ status?: string; site?: string }>;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/10 border-amber-500/10 text-amber-300",
  APPROVED: "bg-emerald-500/10 border-emerald-500/10 text-emerald-300",
  REJECTED: "bg-red-500/10 border-red-500/10 text-red-300",
};

function changeSummary(c: {
  type: string;
  origLitres: number; newLitres: number | null;
  origMeterReading: number | null; newMeterReading: number | null;
  origFuelKind: string; newFuelKind: string | null;
  origIssueDate: Date; newIssueDate: Date | null;
}): string {
  if (c.type === "VOID") return `Void issue (${c.origLitres} L)`;
  const parts: string[] = [];
  if (c.newLitres !== null) parts.push(`litres ${c.origLitres}→${c.newLitres}`);
  if (c.newMeterReading !== null) parts.push(`meter ${c.origMeterReading ?? "—"}→${c.newMeterReading}`);
  if (c.newFuelKind) parts.push(`fuel ${c.origFuelKind.replace("_", " ")}→${c.newFuelKind.replace("_", " ")}`);
  if (c.newIssueDate) parts.push(`date →${new Date(c.newIssueDate).toLocaleDateString("en-GB")}`);
  return parts.join(" · ") || "—";
}

export default async function CorrectionsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  const isAdmin = session.role === "ADMIN";

  const sp = await props.searchParams;
  const status = sp.status || "PENDING";
  const site = sp.site || "ALL";

  const where: any = {};
  if (status !== "ALL") where.status = status;
  if (site !== "ALL") where.projectCode = site;
  // Non-admins only see their own submissions; admins see every member's.
  if (!isAdmin) where.requestedById = session.userId;

  const [corrections, siteRows, pendingCount] = await Promise.all([
    prisma.fuelIssueCorrection.findMany({
      where,
      orderBy: [{ projectCode: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, type: true, status: true, reason: true, createdAt: true,
        origLitres: true, newLitres: true, origMeterReading: true, newMeterReading: true,
        origFuelKind: true, newFuelKind: true, origIssueDate: true, newIssueDate: true,
        assetCode: true, projectCode: true, projectName: true, docName: true,
        reviewNote: true, reviewedAt: true,
        requestedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
    isAdmin
      ? prisma.fuelIssueCorrection.findMany({ distinct: ["projectCode"], select: { projectCode: true, projectName: true } })
      : Promise.resolve([] as { projectCode: string | null; projectName: string | null }[]),
    prisma.fuelIssueCorrection.count({ where: { ...(isAdmin ? {} : { requestedById: session.userId }), status: "PENDING" } }),
  ]);

  const tabs = ["PENDING", "APPROVED", "REJECTED", "ALL"];
  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams({ status, site, ...next });
    return `/fuel/corrections?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-400" /> Fuel Issue Corrections
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {isAdmin
              ? "Approve or reject member-submitted corrections, with the signed running-chart on file. A full, site-sortable activity log."
              : "Your submitted corrections and their approval status."}
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="bg-amber-500/10 border border-amber-500/10 text-amber-300 text-xs font-bold px-3 py-2 rounded-xl">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between bg-[#121420] border border-white/5 rounded-2xl p-3">
        <div className="flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <Link
              key={t}
              href={qs({ status: t })}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                status === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {t}
            </Link>
          ))}
        </div>
        {isAdmin && siteRows.length > 0 && (
          <form method="GET" action="/fuel/corrections" className="flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <Building2 className="w-4 h-4 text-gray-500" />
            <select
              name="site"
              defaultValue={site}
              className="bg-[#1b1e30] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none"
            >
              <option value="ALL">All sites</option>
              {siteRows
                .filter((s) => s.projectCode)
                .map((s) => (
                  <option key={s.projectCode!} value={s.projectCode!}>
                    {s.projectName || s.projectCode} ({s.projectCode})
                  </option>
                ))}
            </select>
            <button type="submit" className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-semibold rounded-lg px-3 py-2">
              Apply
            </button>
          </form>
        )}
      </div>

      {/* Log */}
      {corrections.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-16 text-center text-xs text-gray-500">
          No corrections found for this filter.
        </div>
      ) : (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[920px]">
            <thead>
              <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Site</th>
                <th className="px-5 py-3 font-semibold">Vehicle</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Change</th>
                <th className="px-5 py-3 font-semibold">By</th>
                <th className="px-5 py-3 font-semibold">Doc</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {corrections.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.02] align-top">
                  <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-semibold text-indigo-300">{c.projectCode || "—"}</span>
                    {c.projectName && <span className="text-[10px] text-gray-500 block">{c.projectName}</span>}
                  </td>
                  <td className="px-5 py-3 font-bold text-white">{c.assetCode}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${c.type === "VOID" ? "bg-red-500/10 border-red-500/10 text-red-300" : "bg-white/5 border-white/10 text-gray-300"}`}>
                      {c.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-300">
                    {changeSummary(c)}
                    {c.reason && <span className="text-[10px] text-gray-500 block mt-0.5 italic">“{c.reason}”</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                    <span className="flex items-center gap-1"><User className="w-3 h-3 text-gray-500" />{c.requestedBy.name}</span>
                  </td>
                  <td className="px-5 py-3">
                    <a
                      href={`/api/corrections/${c.id}/document`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      <FileText className="w-3.5 h-3.5" /> View
                    </a>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                    {c.status !== "PENDING" && c.reviewedBy && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
                        <ShieldCheck className="w-3 h-3" />{c.reviewedBy.name}
                      </span>
                    )}
                    {c.reviewNote && <span className="text-[10px] text-gray-500 block mt-0.5">{c.reviewNote}</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {c.status === "PENDING" && isAdmin ? (
                      <CorrectionReviewActions correctionId={c.id} />
                    ) : (
                      <span className="text-[10px] text-gray-600">{c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString("en-GB") : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
