"use client";

import React, { useState, useTransition } from "react";
import { updateBulkTankAction, deleteBulkTankAction } from "@/app/actions/workshop";
import { Database, Edit, X, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";

interface ProjectProp {
  id: string;
  name: string;
  code: string;
}

interface BulkTankProp {
  id: string;
  name: string;
  fuelKind: string;
  capacity: number;
  balance: number;
  projectId: string | null;
  project?: ProjectProp | null;
}

interface ManageTanksClientProps {
  initialTanks: BulkTankProp[];
  projects: ProjectProp[];
}

export default function ManageTanksClient({ initialTanks, projects }: ManageTanksClientProps) {
  const [tanks, setTanks] = useState<BulkTankProp[]>(initialTanks);
  const [editingTank, setEditingTank] = useState<BulkTankProp | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Sync prop changes (if any)
  React.useEffect(() => {
    setTanks(initialTanks);
  }, [initialTanks]);

  const openEditModal = (tank: BulkTankProp) => {
    setEditingTank(tank);
    setError(null);
    setSuccess(false);
  };

  const closeEditModal = () => {
    setEditingTank(null);
    setError(null);
    setSuccess(false);
  };
  
  const handleDeleteTank = async (tankId: string, tankName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete storage pump "${tankName}"? All associated replenishment history will also be removed.`)) {
      return;
    }
    setError(null);
    setSuccess(false);
    
    startTransition(async () => {
      const res = await deleteBulkTankAction(tankId);
      if (res.error) {
        setError(res.error);
      } else {
        setTanks(prev => prev.filter(t => t.id !== tankId));
      }
    });
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTank) return;
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const targetId = editingTank.id;

    startTransition(async () => {
      const res = await updateBulkTankAction(targetId, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        // Optimistically update local state
        const name = formData.get("name")?.toString().trim() || editingTank.name;
        const fuelKind = formData.get("fuelKind")?.toString() || editingTank.fuelKind;
        const capacity = parseFloat(formData.get("capacity")?.toString() || "0") || editingTank.capacity;
        const projectId = formData.get("projectId")?.toString() || null;
        const matchedProject = projects.find(p => p.id === projectId) || null;

        setTanks(prev => prev.map(t => 
          t.id === targetId 
            ? { ...t, name, fuelKind, capacity, projectId, project: matchedProject }
            : t
        ));

        setTimeout(() => closeEditModal(), 1200);
      }
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <Database className="w-4 h-4 text-indigo-400" />
        Active Pump Storages ({tanks.length})
      </h3>

      {tanks.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-12 text-center text-xs text-gray-500">
          No storage tanks registered yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tanks.map((tank) => {
            const percent = Math.min(100, Math.max(0, (tank.balance / tank.capacity) * 100));
            return (
              <div
                key={tank.id}
                className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-bold text-white text-sm block">{tank.name}</span>
                      <span className="text-[10px] text-indigo-300 font-semibold mt-0.5 block">
                        {tank.project ? `Site: ${tank.project.name} (${tank.project.code})` : "Site: Global Pool"}
                      </span>
                    </div>
                    <span className="text-[9px] bg-white/5 border border-white/5 text-gray-400 px-2 py-0.5 rounded font-mono font-bold uppercase whitespace-nowrap">
                      {tank.fuelKind.replace("_", " ")}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1 pt-1">
                    <span className="text-lg font-bold text-indigo-400">{tank.balance.toLocaleString()} L</span>
                    <span className="text-[10px] text-gray-500 font-semibold">/ {tank.capacity.toLocaleString()} L capacity</span>
                  </div>
                </div>

                {/* Progress Bar & Actions */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-500 font-semibold">
                      <span>{percent.toFixed(0)}% full</span>
                      <span>Empty: {(tank.capacity - tank.balance).toLocaleString()} L</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1 border-t border-white/5">
                    <button
                      onClick={() => handleDeleteTank(tank.id, tank.name)}
                      className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 font-bold active:scale-95 transition-all"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => openEditModal(tank)}
                      className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      Edit Pump
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Pump Modal */}
      {editingTank && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative text-left">
            <button
              onClick={closeEditModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-400" />
              Modify Storage Pump Details
            </h3>
            <p className="text-xs text-gray-400">
              Update name, capacity, fuel type, and project site assignment for <strong>{editingTank.name}</strong>.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Storage pump details updated successfully!</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Tank / Pump Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={editingTank.name}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Fuel Type
                </label>
                <select
                  name="fuelKind"
                  required
                  defaultValue={editingTank.fuelKind}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
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
                  defaultValue={editingTank.capacity}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Site Assignment
                </label>
                <select
                  name="projectId"
                  defaultValue={editingTank.projectId || ""}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
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
                disabled={isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
