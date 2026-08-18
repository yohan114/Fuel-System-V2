import React from "react";
import { FUEL_KINDS, DEFAULT_TANK_CAPACITY } from "@/lib/fuel-kinds";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createProjectAction } from "@/app/actions/project";
import { createBulkTankAction } from "@/app/actions/workshop";
import ReplenishmentApprovals from "./ReplenishmentApprovals";
import { 
  FolderGit2, 
  Plus, 
  Users, 
  Car, 
  Calendar, 
  Database, 
  Droplet, 
  Check, 
  X, 
  Layers 
} from "lucide-react";
import ManageTanksClient from "./ManageTanksClient";
import ManageProjectsClient from "./ManageProjectsClient";
import CreateProjectForm from "./CreateProjectForm";

export default async function AdminProjectsPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;

  // 1. Fetch projects with asset and user counts
  const projects = await prisma.project.findMany({
    include: {
      _count: {
        select: {
          users: true,
          assets: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  // 2. Fetch bulk tanks
  const bulkTanks = await prisma.bulkTank.findMany({
    include: { project: true },
    orderBy: { name: "asc" },
  });

  // 3. Fetch pending bulk replenishment requests
  const pendingRequests = await prisma.bulkRequest.findMany({
    where: { status: "PENDING" },
    include: {
      bulkTank: true,
      requestedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-12">
      
      {/* ================= SECTION 1: PROJECT SITES ================= */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Project Site Directories</h2>
          <p className="text-xs text-gray-400 mt-1">Manage project sites, user counts, and allocated fleet machinery.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Create Project Form */}
          <div className="lg:col-span-1 bg-[#121420] border border-white/5 p-5 rounded-2xl shadow-lg h-fit">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              Register Project Site
            </h3>

            <CreateProjectForm />

          </div>

          {/* Projects List */}
          <div className="lg:col-span-2 space-y-4">
            <ManageProjectsClient initialProjects={projects} />
          </div>

        </div>
      </div>

      {/* ================= SECTION 2: WORKSHOP BULK PUMPS ================= */}
      <div className="border-t border-white/5 pt-10 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Workshop Storage Pumps</h2>
          <p className="text-xs text-gray-400 mt-1">Manage bulk storage tanks, current inventories, and replenishment approvals.</p>
        </div>

        {/* Pending Replenishment Approvals Panel */}
        <ReplenishmentApprovals
          requests={pendingRequests.map((r) => ({
            id: r.id,
            tankName: r.bulkTank.name,
            fuelKind: r.fuelKind,
            requestedByName: r.requestedBy.name,
            createdAt: r.createdAt.toISOString(),
            requestedLitres: r.requestedLitres,
          }))}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Create Bulk Tank Form */}
          <div className="lg:col-span-1 bg-[#121420] border border-white/5 p-5 rounded-2xl shadow-lg h-fit">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              Register Storage Tank / Pump
            </h3>

            <form
              action={async (formData) => {
                "use server";
                await createBulkTankAction(formData);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Tank / Pump Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Badalgama Workshop Pump"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Fuel Type
                </label>
                <select
                  name="fuelKind"
                  required
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                >
                  {FUEL_KINDS.map((k) => (
                    <option key={k.code} value={k.code}>{k.short}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Total Capacity (Litres)
                </label>
                <input
                  type="number"
                  name="capacity"
                  step="any"
                  required
                  defaultValue={DEFAULT_TANK_CAPACITY}
                  placeholder="e.g. 15000"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Initial Fuel Level (Litres)
                </label>
                <input
                  type="number"
                  name="initialBalance"
                  step="any"
                  defaultValue="0"
                  placeholder="e.g. 5000"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Site Assignment
                </label>
                <select
                  name="projectId"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none font-semibold"
                >
                  <option value="">No Project Scope (Global Pool)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-2 text-[10px] text-gray-400 leading-relaxed">
                <input
                  type="checkbox"
                  name="allowSecondTank"
                  className="mt-0.5 accent-indigo-500 shrink-0"
                />
                <span>
                  This site has more than one physical pump.
                  <span className="block text-gray-500">
                    Leave unticked — a site normally has one. Ticking it lets you add a second
                    pump record, which splits the site&apos;s fuel history across the two.
                  </span>
                </span>
              </label>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
              >
                Create Tank
              </button>
            </form>
          </div>

          {/* Bulk Tanks List */}
          <div className="lg:col-span-2 space-y-4">
            <ManageTanksClient initialTanks={bulkTanks} projects={projects} />
          </div>

        </div>
      </div>

    </div>
  );
}
