import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ArrowLeft, Wrench, Paperclip, Download, Trash2, FileText } from "lucide-react";
import AttachmentUploader from "./AttachmentUploader";
import { deleteServiceAttachmentAction } from "@/app/actions/attachment";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtRs(cents: number | null | undefined) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtBytes(n: number) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const UPKEEP_LABEL: Record<string, string> = {
  GOOD: "Good",
  NEEDS_REPAIR: "Needs repair",
  UNDER_REPAIR: "Under repair",
};

export default async function ServiceRecordDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  const { id } = await props.params;

  const rec = await prisma.serviceRecord.findUnique({
    where: { id },
    include: {
      asset: { select: { code: true, regNo: true, brand: true, model: true, projectId: true } },
      recordedBy: { select: { name: true } },
      oils: true,
      filters: true,
      costLines: true,
      attachments: { orderBy: { uploadedAt: "desc" }, include: { uploadedBy: { select: { name: true } } } },
    },
  });
  if (!rec) notFound();
  // USERs can only open records for vehicles on their own project/site.
  if (session.role === "USER" && session.projectId && rec.asset.projectId !== session.projectId) notFound();

  const isAdmin = session.role === "ADMIN";
  const meterUnit = rec.meterType === "KM" ? "km" : "hr";
  const hasBreakdown = rec.oils.length || rec.filters.length || rec.costLines.length || rec.grandTotalCents > 0;

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-400" /> {rec.asset.code}
            <span className="text-sm font-normal text-gray-400">· {fmtDate(rec.serviceDate)}</span>
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {[rec.asset.brand, rec.asset.model].filter(Boolean).join(" ")} {rec.asset.regNo ? `· ${rec.asset.regNo}` : ""}
          </p>
        </div>
        <Link href="/service/records" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" /> Records
        </Link>
      </div>

      {/* Header facts */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
        <Fact label="Job no." value={rec.jobNo || "—"} />
        <Fact label="Service type" value={rec.serviceType || "—"} />
        <Fact label="Site" value={rec.siteLocation || "—"} />
        <Fact label="Upkeeping" value={rec.upkeepingStatus ? UPKEEP_LABEL[rec.upkeepingStatus] ?? rec.upkeepingStatus : "—"} />
        <Fact label="Meter at service" value={rec.meterAtService != null ? `${rec.meterAtService.toLocaleString()} ${meterUnit}` : "—"} />
        <Fact label="Next service meter" value={rec.nextServiceMeter != null ? `${rec.nextServiceMeter.toLocaleString()} ${meterUnit}` : "—"} />
        <Fact label="Logged by" value={rec.recordedBy.name} />
        <Fact label="Logged at" value={fmtDate(rec.createdAt)} />
      </div>

      {rec.repairDetails && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 uppercase block mb-1">Repair details</span>
          <p className="text-xs text-gray-300 whitespace-pre-wrap">{rec.repairDetails}</p>
        </div>
      )}

      {/* Oils + Filters */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Oils">
          {rec.oils.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase border-b border-white/5">
                  <th className="py-2">Oil</th>
                  <th className="py-2">Grade</th>
                  <th className="py-2">C/V</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rec.oils.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2 text-gray-300">{o.oilName}</td>
                    <td className="py-2 text-gray-400">{o.oilType || "—"}</td>
                    <td className="py-2 text-gray-400">{o.actionType || "—"}</td>
                    <td className="py-2 text-right text-gray-400 font-mono">{o.quantity || "—"}</td>
                    <td className="py-2 text-right text-white">{fmtRs(o.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Filters">
          {rec.filters.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase border-b border-white/5">
                  <th className="py-2">Filter</th>
                  <th className="py-2">Part no.</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2">X/E</th>
                  <th className="py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rec.filters.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 text-gray-300">{f.filterCategory}</td>
                    <td className="py-2 text-gray-400 font-mono">{f.filterNo || "—"}</td>
                    <td className="py-2 text-right text-gray-400">{f.quantity}</td>
                    <td className="py-2 text-gray-400">{f.actionType || "—"}</td>
                    <td className="py-2 text-right text-white">{fmtRs(f.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* Other costs */}
      {rec.costLines.length > 0 && (
        <Panel title="Other costs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 text-[10px] uppercase border-b border-white/5">
                <th className="py-2">Description</th>
                <th className="py-2">Unit</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rec.costLines.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 text-gray-300">{c.description || "—"}</td>
                  <td className="py-2 text-gray-400">{c.unit || "—"}</td>
                  <td className="py-2 text-right text-gray-400">{fmtRs(c.rateCents)}</td>
                  <td className="py-2 text-right text-gray-400 font-mono">{c.qty || "—"}</td>
                  <td className="py-2 text-right text-white">{fmtRs(c.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Totals */}
      {hasBreakdown && (
        <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Fact label="Parts" value={fmtRs(rec.partsSubtotalCents)} />
          <Fact label={`Labour (${rec.labourRatePct}%)`} value={fmtRs(rec.labourChargeCents)} />
          <Fact label={`Sundry (${rec.sundryRatePct}%)`} value={fmtRs(rec.sundryAmountCents)} />
          <div className="rounded-xl p-3 border bg-indigo-500/10 border-indigo-500/20">
            <span className="text-[10px] text-gray-400 uppercase block">Grand total</span>
            <span className="text-indigo-300 font-bold text-sm block mt-0.5">{fmtRs(rec.grandTotalCents || rec.costCents)}</span>
          </div>
        </div>
      )}

      {/* Attachments */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-indigo-400" /> Attachments <span className="text-gray-600 font-normal">({rec.attachments.length})</span>
        </h2>
        {rec.attachments.length === 0 ? (
          <div className="text-xs text-gray-500">No files attached.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {rec.attachments.map((a) => {
              const url = `/api/service-attachments/${a.id}`;
              const isImage = (a.mimeType || "").startsWith("image/");
              return (
                <div key={a.id} className="bg-[#1b1e30] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
                  <a href={url} target="_blank" rel="noreferrer" className="block">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={a.originalName} className="w-full h-24 object-cover rounded-lg border border-white/5" />
                    ) : (
                      <div className="w-full h-24 rounded-lg border border-white/5 bg-[#121420] flex items-center justify-center">
                        <FileText className="w-8 h-8 text-gray-500" />
                      </div>
                    )}
                  </a>
                  <div className="min-w-0">
                    <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-gray-200 hover:text-indigo-400 font-medium block truncate" title={a.originalName}>{a.originalName}</a>
                    <span className="text-[10px] text-gray-500 block">{fmtBytes(a.fileSize)}{a.caption ? ` · ${a.caption}` : ""}</span>
                    <span className="text-[10px] text-gray-600 block">{a.uploadedBy?.name ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={`${url}?download=1`} className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"><Download className="w-3 h-3" /> Download</a>
                    {isAdmin && (
                      <form action={async () => { "use server"; await deleteServiceAttachmentAction(a.id); }} className="ml-auto">
                        <button type="submit" title="Remove" className="text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {isAdmin && <AttachmentUploader serviceRecordId={rec.id} />}
      </div>

      {rec.note && (
        <p className="text-xs text-gray-500">
          <span className="uppercase text-[10px] text-gray-600">Note:</span> {rec.note}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-gray-500 uppercase block">{label}</span>
      <span className="text-white font-semibold block mt-0.5">{value}</span>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
      <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
function Empty() {
  return <div className="text-center py-6 text-xs text-gray-500">None recorded.</div>;
}
