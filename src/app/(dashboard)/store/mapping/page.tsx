import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { unresolvedAliases, projectOptions } from "@/lib/stock/queries";
import { Repeat, CheckCircle2 } from "lucide-react";
import ResolveForm from "./ResolveForm";

export default async function StoreMappingPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "STOREKEEPER") redirect("/");

  const [aliases, projects] = await Promise.all([unresolvedAliases(), projectOptions()]);
  const projectOpts = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Repeat className="w-5 h-5 text-indigo-400" /> Stock Mapping
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Issue descriptions that didn&apos;t auto-match a machine or project. Map one and every matching past issue is linked too.
        </p>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {aliases.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
            Everything is mapped — no unresolved consumers.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Description</th>
                <th className="py-2.5 text-center">Times seen</th>
                <th className="py-2.5">Map to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {aliases.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-white font-medium">{a.rawText}</td>
                  <td className="py-3 text-center text-gray-400">{a.hitCount}</td>
                  <td className="py-3"><ResolveForm aliasId={a.id} projects={projectOpts} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
