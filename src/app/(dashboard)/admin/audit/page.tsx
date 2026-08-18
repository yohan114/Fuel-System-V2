import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ScrollText } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ action?: string; entity?: string; q?: string }>;
}

const ACTION_STYLES: Record<string, string> = {
  CREATE: "bg-emerald-500/10 text-emerald-400",
  UPDATE: "bg-indigo-500/10 text-indigo-400",
  DELETE: "bg-red-500/10 text-red-400",
  APPROVE: "bg-emerald-500/10 text-emerald-400",
  REJECT: "bg-red-500/10 text-red-400",
  LOGIN: "bg-gray-500/10 text-gray-400",
};

export default async function AuditPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const sp = await props.searchParams;
  const where: any = {};
  if (sp.action) where.action = sp.action;
  if (sp.entity) where.entity = sp.entity;
  if (sp.q) where.summary = { contains: sp.q };

  const [logs, entities, actions] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { name: true } } } }),
    prisma.auditLog.findMany({ select: { entity: true }, distinct: ["entity"], orderBy: { entity: "asc" } }),
    prisma.auditLog.findMany({ select: { action: true }, distinct: ["action"], orderBy: { action: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-indigo-400" /> Audit Log
        </h1>
        <p className="text-xs text-gray-400 mt-1">Most recent 200 entries. Filter by action, entity or text.</p>
      </div>

      <form method="GET" action="/admin/audit" className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <select name="action" defaultValue={sp.action || ""} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}
        </select>
        <select name="entity" defaultValue={sp.entity || ""} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
          <option value="">All entities</option>
          {entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity}</option>)}
        </select>
        <input type="text" name="q" defaultValue={sp.q || ""} placeholder="Search summary…" className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
        <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2">Filter</button>
      </form>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {logs.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No log entries match.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5 whitespace-nowrap">When</th>
                <th className="py-2.5">Action</th>
                <th className="py-2.5">Entity</th>
                <th className="py-2.5">Actor</th>
                <th className="py-2.5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-white/[0.01] align-top">
                  <td className="py-3 text-gray-500 font-mono whitespace-nowrap">{new Date(l.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="py-3"><span className={`px-2 py-0.5 rounded text-[9px] font-bold ${ACTION_STYLES[l.action] || "bg-white/5 text-gray-400"}`}>{l.action}</span></td>
                  <td className="py-3 text-gray-300">{l.entity}</td>
                  <td className="py-3 text-gray-400">{l.actor?.name || "System"}</td>
                  <td className="py-3 text-gray-400 max-w-[460px]">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
