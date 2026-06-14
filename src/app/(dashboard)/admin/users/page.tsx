import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createUserAction, toggleUserStatusAction } from "@/app/actions/admin";
import { Users2, Plus, UserCheck, ShieldAlert, CheckCircle2, Power } from "lucide-react";
import ManageUsersClient from "./ManageUsersClient";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) return null;

  // 1. Fetch all system users, projects, and bulk tanks
  const users = await prisma.user.findMany({
    include: { project: true, bulkTank: true },
    orderBy: {
      username: "asc",
    },
  });

  const projects = await prisma.project.findMany({
    orderBy: {
      name: "asc",
    },
  });

  const bulkTanks = await prisma.bulkTank.findMany({
    orderBy: {
      name: "asc",
    },
  });

  return (
    <div className="space-y-8">
      {/* Create New User Account Form */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-400" />
          Register New User Account
        </h3>

        <form action={async (formData) => {
          "use server";
          await createUserAction(formData);
        }} className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Username */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Username
              </label>
              <input
                type="text"
                name="username"
                required
                placeholder="e.g. yohan"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* Name */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Full Name
              </label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g. Yohan Perera"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Email Address (Optional)
              </label>
              <input
                type="email"
                name="email"
                placeholder="e.g. yohan@example.com"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Temporary Password
              </label>
              <input
                type="password"
                name="password"
                required
                placeholder="••••••••"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* Role select */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                User Role Rights
              </label>
              <select
                name="role"
                required
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
              >
                <option value="USER">User (Add-Only Requests & Readings)</option>
                <option value="ADMIN">Admin (Full System Controls)</option>
                <option value="ALLOCATOR">Allocator (Project Vehicle Manager)</option>
                <option value="WORKSHOP">Workshop Pump Operator</option>
              </select>
            </div>

            {/* Project select */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Project Assignment (For User Role Only)
              </label>
              <select
                name="projectId"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
              >
                <option value="">No Project Scope (Global Pool)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Bulk Tank select */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Bulk Tank Assignment (For Workshop Role Only)
              </label>
              <select
                name="bulkTankId"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
              >
                <option value="">No Tank Scope</option>
                {bulkTanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.fuelKind})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
          >
            Create User Account
          </button>
        </form>
      </div>

      {/* User Accounts Directory */}
      <div className="border-t border-white/5 pt-6">
        <ManageUsersClient
          initialUsers={users}
          projects={projects}
          bulkTanks={bulkTanks}
          currentUserId={session.userId}
        />
      </div>
    </div>
  );
}
