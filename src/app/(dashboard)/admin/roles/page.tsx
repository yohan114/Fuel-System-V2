import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shield, Check, X, Users, Lock, Info } from "lucide-react";

export default async function AdminRolesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  // Fetch count of users per role
  const userCounts = await prisma.user.groupBy({
    by: ["role"],
    _count: { id: true },
    where: { active: true },
  });

  const countMap: Record<string, number> = {};
  for (const c of userCounts) {
    countMap[c.role] = c._count.id;
  }

  const permissions = [
    {
      category: "Fleet Management",
      features: [
        { name: "View fleet assets & specs", roles: ["ADMIN", "ALLOCATOR", "USER", "SITE_PUMP", "WORKSHOP"] },
        { name: "Register new vehicle/machine", roles: ["ADMIN", "ALLOCATOR"] },
        { name: "Edit machine specifications & caps", roles: ["ADMIN", "ALLOCATOR"] },
        { name: "Dispose / Inactive vehicle", roles: ["ADMIN"] },
      ],
    },
    {
      category: "Fuel Operations",
      features: [
        { name: "Issue fuel from pump", roles: ["ADMIN", "SITE_PUMP", "WORKSHOP"] },
        { name: "Submit fuel draw request", roles: ["ADMIN", "USER", "ALLOCATOR", "SITE_PUMP", "WORKSHOP"] },
        { name: "Approve / Reject fuel requests", roles: ["ADMIN"] },
        { name: "Void & restore fuel dispenses", roles: ["ADMIN"] },
        { name: "Submit fuel correction request", roles: ["ADMIN", "USER", "SITE_PUMP", "WORKSHOP"] },
        { name: "Configure Ceypetco fuel prices", roles: ["ADMIN"] },
      ],
    },
    {
      category: "Allocations & Postings",
      features: [
        { name: "View machine site postings", roles: ["ADMIN", "ALLOCATOR", "USER", "SITE_PUMP", "WORKSHOP"] },
        { name: "Assign machines to sites", roles: ["ADMIN", "ALLOCATOR"] },
        { name: "Import vehicle monthly allocations", roles: ["ADMIN", "ALLOCATOR"] },
      ],
    },
    {
      category: "Billing & Finance",
      features: [
        { name: "View all site bills & invoices", roles: ["ADMIN", "ALLOCATOR"] },
        { name: "View own site invoices only", roles: ["USER", "SITE_PUMP"] },
        { name: "Generate & recalculate monthly bills", roles: ["ADMIN"] },
        { name: "Issue & finalize invoices", roles: ["ADMIN"] },
        { name: "Manage billing overrides", roles: ["ADMIN"] },
        { name: "Record invoice payments & credits", roles: ["ADMIN"] },
      ],
    },
    {
      category: "Administration & Security",
      features: [
        { name: "Manage user accounts & credentials", roles: ["ADMIN"] },
        { name: "Issue & revoke REST API keys", roles: ["ADMIN"] },
        { name: "Trigger & restore database backups", roles: ["ADMIN"] },
        { name: "Audit logs inspection", roles: ["ADMIN"] },
      ],
    },
  ];

  const roleDefinitions = [
    {
      role: "ADMIN",
      title: "System Administrator",
      desc: "Full unrestricted access across all sites, financial billing, system settings, and audit logs.",
      badge: "bg-red-500/20 text-red-300 border-red-500/30",
    },
    {
      role: "ALLOCATOR",
      title: "Fleet Allocator",
      desc: "Manages asset assignments, monthly site postings, and vehicle fleet registry. Full company-wide read access.",
      badge: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    },
    {
      role: "WORKSHOP",
      title: "Central Workshop Operator",
      desc: "Operates central workshop pump. Can issue fuel to any vehicle and log service maintenance records.",
      badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    },
    {
      role: "SITE_PUMP",
      title: "Site Pump Attendant",
      desc: "Stationed at a specific site pump. Can dispense fuel from their assigned tank and log meter readings.",
      badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    },
    {
      role: "USER",
      title: "Site User / Project Manager",
      desc: "Site-scoped view. Can raise fuel requests, view their site's machinery, and inspect site invoices.",
      badge: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">
          Role & Permission Matrix
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Access control policies governing web dashboard users and REST API client permissions.
        </p>
      </div>

      {/* Role Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {roleDefinitions.map((rd) => (
          <div
            key={rd.role}
            className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rd.badge}`}>
                  {rd.role}
                </span>
                <span className="text-xs font-mono font-bold text-white flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  {countMap[rd.role] || 0}
                </span>
              </div>
              <div className="font-bold text-sm text-white">{rd.title}</div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                {rd.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Matrix Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              System Capability Matrix
            </span>
          </div>
          <span className="text-xs text-slate-500">
            5 Roles • {permissions.reduce((s, p) => s + p.features.length, 0)} Features
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-3 px-4 w-1/3">Feature / Capability</th>
                <th className="py-3 px-3 text-center">ADMIN</th>
                <th className="py-3 px-3 text-center">ALLOCATOR</th>
                <th className="py-3 px-3 text-center">WORKSHOP</th>
                <th className="py-3 px-3 text-center">SITE_PUMP</th>
                <th className="py-3 px-3 text-center">USER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {permissions.map((group) => (
                <React.Fragment key={group.category}>
                  <tr className="bg-slate-950/40">
                    <td
                      colSpan={6}
                      className="py-2.5 px-4 font-bold text-blue-400 uppercase tracking-wider text-[11px]"
                    >
                      {group.category}
                    </td>
                  </tr>
                  {group.features.map((feat) => (
                    <tr key={feat.name} className="hover:bg-slate-850/40">
                      <td className="py-2.5 px-4 text-slate-200">
                        {feat.name}
                      </td>
                      {(["ADMIN", "ALLOCATOR", "WORKSHOP", "SITE_PUMP", "USER"] as const).map(
                        (role) => {
                          const allowed = feat.roles.includes(role);
                          return (
                            <td key={role} className="py-2.5 px-3 text-center">
                              {allowed ? (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400">
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800/50 text-slate-600">
                                  <X className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
