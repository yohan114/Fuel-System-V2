import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, Paperclip, FileText } from "lucide-react";
import { conditionLabel } from "@/lib/service/sheet";

interface PageProps { params: Promise<{ id: string }> }

function rs(c: number | null | undefined) {
  return c == null ? "—" : "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default async function ServiceRecordPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  const { id } = await props.params;

  const rec = await prisma.serviceRecord.findUnique({
    where: { id },
    include: {
      asset: { select: { code: true, regNo: true, model: true, brand: true, projectId: true } },
      items: true,
      attachments: { select: { id: true, fileName: true, mimeType: true }, orderBy: { createdAt: "asc" } },
      recordedBy: { select: { name: true } },
    },
  });
  if (!rec) notFound();
  if (session.role === "USER" && session.projectId && rec.asset.projectId !== session.projectId) notFound();

  const oils = rec.items.filter((i) => i.kind === "OIL");
  const filters = rec.items.filter((i) => i.kind === "FILTER");
  const manpower = rec.items.filter((i) => i.kind === "MANPOWER");
  const card = "bg-[#121420] border border-white/5 rounded-2xl p-5";
  const meta = (k: string, v: React.ReactNode) => (
    <div><dt className="text-[10px] uppercase tracking-wider text-gray-500">{k}</dt><dd className="text-sm text-white mt-0.5">{v}</dd></div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/fleet/${rec.asset.code}`} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> {rec.asset.code}</Link>

      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-white">Service — {rec.asset.code}</h1>
            <p className="text-xs text-gray-500">{rec.asset.regNo || ""} {rec.asset.model || rec.asset.brand || ""}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Total</div>
            <div className="text-xl font-bold text-cyan-300 font-mono">{rs(rec.costCents)}</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {meta("Date", fmt(rec.serviceDate))}
          {meta("Job No", rec.jobNo || "—")}
          {meta("Meter", rec.meterAtService != null ? `${rec.meterAtService.toLocaleString()} ${rec.meterType}` : "—")}
          {meta("Next service", rec.nextServiceMeter != null ? `${rec.nextServiceMeter.toLocaleString()} ${rec.meterType}` : "—")}
          {meta("Service type", rec.serviceType || "—")}
          {meta("Location", rec.location || "—")}
          {meta("Condition", conditionLabel(rec.condition))}
          {meta("Logged by", rec.recordedBy?.name || "—")}
        </dl>
      </div>

      {oils.length > 0 && <ItemTable title="Lubricants" cols={["Oil name", "Grade", "C/V", "Litres", "Rate/L", "Amount"]} rows={oils.map((i) => [i.description, i.partNo || "—", i.action || "—", i.qty, rs(i.unitPriceCents), rs(i.amountCents)])} />}
      {filters.length > 0 && <ItemTable title="Filters" cols={["Filter", "Filter no.", "X/E", "Qty", "Rate", "Amount"]} rows={filters.map((i) => [i.description, i.partNo || "—", i.action || "—", i.qty, rs(i.unitPriceCents), rs(i.amountCents)])} />}
      {manpower.length > 0 && <ItemTable title="Manpower / other" cols={["Description", "", "", "Qty", "Rate", "Amount"]} rows={manpower.map((i) => [i.description, "", "", i.qty, rs(i.unitPriceCents), rs(i.amountCents)])} />}

      {/* Cost breakdown */}
      <div className={card}>
        <div className="max-w-sm ml-auto space-y-1.5 text-xs">
          <Line k="Parts (lubricants + filters)" v={rs(rec.partsCents)} />
          <Line k="Manpower / other" v={rs(rec.manpowerCents)} />
          <Line k="Labour charge" v={rs(rec.labourCents)} />
          <Line k="Sundry" v={rs(rec.sundryCents)} />
          <div className="flex items-center justify-between border-t border-white/10 pt-2 mt-1">
            <span className="text-cyan-300 font-bold uppercase tracking-wider text-[11px]">Total</span>
            <span className="text-cyan-300 font-bold text-sm font-mono">{rs(rec.costCents)}</span>
          </div>
        </div>
      </div>

      {rec.note && <div className={card + " text-xs text-gray-400"}><span className="text-gray-500 uppercase tracking-wider text-[10px]">Note</span><p className="mt-1">{rec.note}</p></div>}

      {rec.attachments.length > 0 && (
        <div className={card}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2"><Paperclip className="w-3.5 h-3.5" /> Attachments</h3>
          <div className="flex flex-wrap gap-2">
            {rec.attachments.map((a) => (
              <a key={a.id} href={`/api/service/${rec.id}/attachment/${a.id}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200">
                <FileText className="w-3.5 h-3.5 text-cyan-400" /> {a.fileName}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between"><span className="text-gray-400">{k}</span><span className="text-gray-300 font-mono">{v}</span></div>;
}

function ItemTable({ title, cols, rows }: { title: string; cols: string[]; rows: (React.ReactNode)[][] }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-500">{cols.map((c, i) => <th key={i} className={`px-2 py-1.5 font-semibold ${i >= cols.length - 2 ? "text-right" : ""}`}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                {r.map((cell, j) => <td key={j} className={`px-2 py-1.5 ${j >= cols.length - 2 ? "text-right font-mono text-gray-300" : "text-gray-200"}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
