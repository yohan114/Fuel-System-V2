import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createProjectAction } from "@/app/actions/project";
import { 
  createBulkTankAction, 
  approveBulkRequestAction, 
  rejectBulkRequestAction 
} from "@/app/actions/workshop";
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

            <form
              action={async (formData) => {
                "use server";
                await createProjectAction(formData);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Ruwanwella Water Project"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Code
                </label>
                <input
                  type="text"
                  name="code"
                  required
                  placeholder="e.g. RWP"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-bold tracking-wide"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Billing Contact Name
                </label>
                <input
                  type="text"
                  name="contactName"
                  placeholder="e.g. Site Accounts Officer"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Billing Contact Email
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  placeholder="invoices@site.example"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
              >
                Register Project
              </button>
            </form>
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
        {pendingRequests.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-6 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              Pending Replenishment Approvals ({pendingRequests.length})
            </h3>
            
            <div className="divide-y divide-white/5">
              {pendingRequests.map((req) => (
                <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{req.bulkTank.name}</span>
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded uppercase">
                        {req.fuelKind.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      Requested by {req.requestedBy.name} • {new Date(req.createdAt).toLocaleString()}
                    </p>
                    <p className="text-white font-bold mt-2 text-md">
                      Request Quantity: {req.requestedLitres.toLocaleString()} L
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <form action={async () => {
                      "use server";
                      await approveBulkRequestAction(req.id, "Approved by Admin");
                    }}>
                      <button
                        type="submit"
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all shadow-md"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve Refuel
                      </button>
                    </form>
                    
                    <form action={async () => {
                      "use server";
                      await rejectBulkRequestAction(req.id, "Rejected by Admin");
                    }}>
                      <button
                        type="submit"
                        className="flex items-center gap-1 bg-white/5 hover:bg-red-500/10 hover:text-red-400 text-gray-400 border border-white/5 font-semibold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
                  <option value="AUTO_DIESEL">Auto Diesel</option>
                  <option value="SUPER_DIESEL">Super Diesel</option>
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
