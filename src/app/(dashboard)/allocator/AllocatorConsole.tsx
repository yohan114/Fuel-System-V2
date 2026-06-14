"use client";

import React, { useState, useTransition } from "react";
import { assignAssetToProjectAction } from "@/app/actions/project";
import { 
  Car, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle2, 
  Building2, 
  RefreshCw 
} from "lucide-react";

interface ProjectProp {
  id: string;
  name: string;
  code: string;
}

interface AssetProp {
  id: string;
  code: string;
  brand: string | null;
  typeLabel: string | null;
  regNo: string | null;
  meterType: string;
  projectId: string | null;
  project: ProjectProp | null;
  category: {
    id: string;
    code: string;
    name: string;
  };
}

interface AllocatorConsoleProps {
  initialAssets: AssetProp[];
  projects: ProjectProp[];
  isAdmin: boolean;
}

export default function AllocatorConsole({ 
  initialAssets, 
  projects, 
  isAdmin 
}: AllocatorConsoleProps) {
  const [assets, setAssets] = useState<AssetProp[]>(initialAssets);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("ALL"); // "ALL" | "UNASSIGNED" | projectId
  const [isPending, startTransition] = useTransition();
  const [updatingAssetId, setUpdatingAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Handle dropdown change event
  const handleAssignProject = async (assetId: string, projectId: string) => {
    const targetProjId = projectId === "" ? null : projectId;
    setUpdatingAssetId(assetId);
    setMessage(null);

    startTransition(async () => {
      const res = await assignAssetToProjectAction(assetId, targetProjId);
      setUpdatingAssetId(null);

      if (res.error) {
        setMessage({ type: "error", text: res.error });
      } else {
        const targetProj = projects.find((p) => p.id === targetProjId) || null;
        setAssets((prev) =>
          prev.map((a) =>
            a.id === assetId
              ? { ...a, projectId: targetProjId, project: targetProj }
              : a
          )
        );
        setMessage({
          type: "success",
          text: `Successfully updated assignment.`,
        });
        setTimeout(() => setMessage(null), 3000);
      }
    });
  };

  // Filter logic
  const filteredAssets = assets.filter((asset) => {
    // 1. Search filter
    const codeMatch = asset.code.toLowerCase().includes(search.toLowerCase());
    const regMatch = asset.regNo?.toLowerCase().includes(search.toLowerCase()) || false;
    const brandMatch = asset.brand?.toLowerCase().includes(search.toLowerCase()) || false;
    const typeMatch = asset.typeLabel?.toLowerCase().includes(search.toLowerCase()) || false;
    const searchMatch = codeMatch || regMatch || brandMatch || typeMatch;

    // 2. Project filter
    let projectMatch = true;
    if (projectFilter === "UNASSIGNED") {
      projectMatch = asset.projectId === null;
    } else if (projectFilter !== "ALL") {
      projectMatch = asset.projectId === projectFilter;
    }

    return searchMatch && projectMatch;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">Fleet Asset Allocations</h1>
        <p className="text-xs text-gray-400 mt-1">
          Link or unlink vehicle and machinery assets to active project sites. Unassigned assets are hidden from project user logs.
        </p>
      </div>

      {/* Notifications */}
      {message && (
        <div
          className={`flex items-start gap-2.5 rounded-xl p-4 text-xs font-semibold tracking-wide border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 border-red-500/10 text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Filters Area */}
      <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl flex flex-col md:flex-row gap-4 justify-between items-center shadow-lg">
        {/* Search */}
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by code, brand, model, plate..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>

        {/* Project filtering tab select */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Filter className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="w-full md:w-56 bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
          >
            <option value="ALL">All Assets (Assigned & Unassigned)</option>
            <option value="UNASSIGNED">Unassigned Assets Only</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Allocation Directories */}
      <div className="border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              <th className="px-6 py-3">Asset Registry Info</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Assigned Site / Project</th>
              <th className="px-6 py-3 text-right">Assign to Site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-[#121420]/50">
            {filteredAssets.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-gray-500">
                  No assets match your search/filter parameters.
                </td>
              </tr>
            ) : (
              filteredAssets.map((asset) => {
                const isLoading = updatingAssetId === asset.id;
                return (
                  <tr key={asset.id} className="hover:bg-white/[0.01] transition-colors">
                    {/* Name & Plate */}
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center font-bold text-indigo-400 border border-indigo-500/10">
                          <Car className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-bold text-white block text-sm">
                            {asset.code}
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono block">
                            {asset.brand || "—"} {asset.typeLabel ? `• ${asset.typeLabel}` : ""} {asset.regNo ? `[${asset.regNo}]` : ""}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-6 py-3.5 text-gray-400">
                      <span className="bg-white/5 border border-white/5 px-2 py-0.5 rounded text-[10px] font-semibold">
                        {asset.category.code} - {asset.category.name}
                      </span>
                    </td>

                    {/* Current Project Assignment */}
                    <td className="px-6 py-3.5 font-bold">
                      {asset.project ? (
                        <span className="text-indigo-400 flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                          {asset.project.name}
                        </span>
                      ) : (
                        <span className="text-gray-500 italic">Unassigned (Pool)</span>
                      )}
                    </td>

                    {/* Link dropdown */}
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isLoading && (
                          <RefreshCw className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                        )}
                        <select
                          disabled={isLoading}
                          value={asset.projectId || ""}
                          onChange={(e) => handleAssignProject(asset.id, e.target.value)}
                          className="bg-[#1b1e30] border border-white/5 rounded-xl px-2.5 py-1.5 text-white text-xs focus:outline-none disabled:opacity-50 max-w-[200px]"
                        >
                          <option value="">-- UNASSIGNED (POOL) --</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
