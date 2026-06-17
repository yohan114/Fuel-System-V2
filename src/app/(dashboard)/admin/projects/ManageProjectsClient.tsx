"use client";

import React, { useState, useTransition } from "react";
import { updateProjectAction, deleteProjectAction } from "@/app/actions/project";
import { FolderGit2, Edit, X, AlertTriangle, CheckCircle, RefreshCw, Calendar, Users, Car } from "lucide-react";

interface ProjectProp {
  id: string;
  name: string;
  code: string;
  contactName?: string | null;
  contactEmail?: string | null;
  createdAt: Date | string;
  _count?: {
    users: number;
    assets: number;
  };
}

interface ManageProjectsClientProps {
  initialProjects: ProjectProp[];
}

export default function ManageProjectsClient({ initialProjects }: ManageProjectsClientProps) {
  const [projects, setProjects] = useState<ProjectProp[]>(initialProjects);
  const [editingProject, setEditingProject] = useState<ProjectProp | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Sync prop changes (if any)
  React.useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const openEditModal = (proj: ProjectProp) => {
    setEditingProject(proj);
    setError(null);
    setSuccess(false);
  };

  const closeEditModal = () => {
    setEditingProject(null);
    setError(null);
    setSuccess(false);
  };

  const handleDeleteProject = async (projectId: string, name: string) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete the project site "${name}"?\n\n` +
        `This will automatically unlink all users, assets, and storage pumps currently scoped to this site (they will revert to the global unassigned pool).`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const res = await deleteProjectAction(projectId);
      if (res.error) {
        alert(res.error);
      } else {
        setProjects(prev => prev.filter(p => p.id !== projectId));
      }
    });
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProject) return;
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const targetId = editingProject.id;

    startTransition(async () => {
      const res = await updateProjectAction(targetId, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        // Update local state
        const name = formData.get("name")?.toString().trim() || editingProject.name;
        const code = formData.get("code")?.toString().trim().toUpperCase() || editingProject.code;
        const contactName = formData.get("contactName")?.toString().trim() || null;
        const contactEmail = formData.get("contactEmail")?.toString().trim() || null;

        setProjects(prev => prev.map(p =>
          p.id === targetId
            ? { ...p, name, code, contactName, contactEmail }
            : p
        ));

        setTimeout(() => closeEditModal(), 1200);
      }
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <FolderGit2 className="w-4 h-4 text-indigo-400" />
        Active Sites ({projects.length})
      </h3>

      {projects.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-12 text-center text-xs text-gray-500">
          No project sites registered yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="bg-[#121420] border border-white/5 hover:border-indigo-500/20 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/10 text-indigo-400 font-bold px-2 py-0.5 rounded font-mono">
                    {proj.code}
                  </span>
                  <span className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(proj.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-white tracking-wide">{proj.name}</h4>
                {proj.contactEmail && (
                  <p className="text-[10px] text-gray-500 mt-1 truncate">
                    {proj.contactName ? `${proj.contactName} · ` : ""}{proj.contactEmail}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-4 mt-6 pt-4 border-t border-white/5">
                <div className="flex items-center gap-4 text-xs text-gray-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-gray-500" />
                    {proj._count?.users || 0} Users
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Car className="w-4 h-4 text-gray-500" />
                    {proj._count?.assets || 0} Assets
                  </span>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-white/[0.03]">
                  <button
                    onClick={() => handleDeleteProject(proj.id, proj.name)}
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold active:scale-95 transition-all"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => openEditModal(proj)}
                    className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Edit Site
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative text-left">
            <button
              onClick={closeEditModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-indigo-400" />
              Modify Project Site details
            </h3>
            <p className="text-xs text-gray-400">
              Update code and name details for the project site: <strong>{editingProject.name}</strong>.
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
                <span>Project site details updated successfully!</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={editingProject.name}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 font-semibold"
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
                  defaultValue={editingProject.code}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 font-bold uppercase tracking-wider"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Billing Contact Name
                </label>
                <input
                  type="text"
                  name="contactName"
                  defaultValue={editingProject.contactName || ""}
                  placeholder="e.g. Site Accounts Officer"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Billing Contact Email
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  defaultValue={editingProject.contactEmail || ""}
                  placeholder="invoices@site.example"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50"
                />
                <p className="text-[10px] text-gray-500 mt-1.5">Invoices are emailed to this address.</p>
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
