"use client";

import React, { useState, useTransition } from "react";
import {
  toggleUserStatusAction,
  updateUserAssignmentAction,
  resetUserPasswordAction,
  deleteUserAction,
} from "@/app/actions/admin";
import { Users2, Edit, Power, X, AlertTriangle, CheckCircle, RefreshCw, KeyRound, Trash2 } from "lucide-react";
import { isSiteUser, isPumpOperator } from "@/lib/roles";

interface ProjectProp {
  id: string;
  name: string;
  code: string;
}

interface BulkTankProp {
  id: string;
  name: string;
  fuelKind: string;
}

interface UserProp {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
  projectId: string | null;
  bulkTankId: string | null;
  project?: ProjectProp | null;
  bulkTank?: BulkTankProp | null;
}

interface ManageUsersClientProps {
  initialUsers: UserProp[];
  projects: ProjectProp[];
  bulkTanks: BulkTankProp[];
  currentUserId: string;
}

export default function ManageUsersClient({
  initialUsers,
  projects,
  bulkTanks,
  currentUserId,
}: ManageUsersClientProps) {
  const [users, setUsers] = useState<UserProp[]>(initialUsers);
  const [editingUser, setEditingUser] = useState<UserProp | null>(null);
  const [resetUser, setResetUser] = useState<UserProp | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProp | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Synchronize initial users prop
  React.useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  const openEditModal = (user: UserProp) => {
    setEditingUser(user);
    setError(null);
    setSuccess(false);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setError(null);
    setSuccess(false);
  };

  const handleToggleStatus = (targetId: string, currentActiveStatus: boolean) => {
    startTransition(async () => {
      const res = await toggleUserStatusAction(targetId, !currentActiveStatus);
      if (!res.error) {
        setUsers(prev =>
          prev.map(u => (u.id === targetId ? { ...u, active: !currentActiveStatus } : u))
        );
      }
    });
  };

  const openResetModal = (user: UserProp) => {
    setResetUser(user);
    setResetError(null);
    setResetSuccess(false);
  };

  const closeResetModal = () => {
    setResetUser(null);
    setResetError(null);
    setResetSuccess(false);
  };

  const handleResetSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resetUser) return;
    setResetError(null);
    setResetSuccess(false);

    const formData = new FormData(e.currentTarget);
    const targetId = resetUser.id;

    startTransition(async () => {
      const res = await resetUserPasswordAction(targetId, formData);
      if (res.error) {
        setResetError(res.error);
      } else {
        setResetSuccess(true);
        setTimeout(() => closeResetModal(), 1400);
      }
    });
  };

  const openDeleteModal = (user: UserProp) => {
    setDeletingUser(user);
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    setDeletingUser(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = () => {
    if (!deletingUser) return;
    setDeleteError(null);
    const targetId = deletingUser.id;

    startTransition(async () => {
      const res = await deleteUserAction(targetId);
      if (res.error) {
        setDeleteError(res.error);
      } else {
        setUsers(prev => prev.filter(u => u.id !== targetId));
        closeDeleteModal();
      }
    });
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUser) return;
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const targetId = editingUser.id;

    startTransition(async () => {
      const res = await updateUserAssignmentAction(targetId, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        // Optimistically update local state
        const name = formData.get("name")?.toString().trim() || editingUser.name;
        const role = formData.get("role")?.toString() || editingUser.role;
        const projectId = formData.get("projectId")?.toString() || null;
        const bulkTankId = formData.get("bulkTankId")?.toString() || null;

        const matchedProject = projects.find(p => p.id === projectId) || null;
        const matchedTank = bulkTanks.find(t => t.id === bulkTankId) || null;

        setUsers(prev =>
          prev.map(u =>
            u.id === targetId
              ? {
                  ...u,
                  name,
                  role,
                  projectId: isSiteUser(role) ? projectId : null,
                  bulkTankId: isPumpOperator(role) ? bulkTankId : null,
                  project: isSiteUser(role) ? matchedProject : null,
                  bulkTank: isPumpOperator(role) ? matchedTank : null,
                }
              : u
          )
        );

        setTimeout(() => closeEditModal(), 1200);
      }
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <Users2 className="w-4 h-4 text-emerald-400" />
        Active System User Directories ({users.length})
      </h3>

      <div className="border border-white/5 rounded-2xl overflow-hidden shadow-lg">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              <th className="px-6 py-3">User</th>
              <th className="px-6 py-3">Role</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Scope Scope</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map(u => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="hover:bg-white/[0.01]">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center font-bold text-indigo-400 border border-indigo-500/10">
                        {u.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-bold text-white block text-sm">{u.name}</span>
                        <span className="text-[10px] text-gray-500 font-mono block">@{u.username}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        u.role === "ADMIN"
                          ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/10"
                          : "bg-white/5 text-gray-400 border border-white/5"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-gray-400 font-medium">
                    {u.email || "—"}
                  </td>
                  <td className="px-6 py-3.5 text-indigo-300 font-semibold">
                    {[
                      isSiteUser(u.role) && u.project ? `Site: ${u.project.name}` : null,
                      isPumpOperator(u.role) && u.bulkTank ? `Tank: ${u.bulkTank.name}` : null,
                    ].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        u.active
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/10"
                          : "bg-red-500/10 text-red-400 border border-red-500/10"
                      }`}
                    >
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-3.5">
                      <button
                        onClick={() => openEditModal(u)}
                        className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold hover:underline"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Edit
                      </button>

                      <button
                        onClick={() => openResetModal(u)}
                        className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 font-bold hover:underline"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset PW
                      </button>

                      {isSelf ? (
                        <span className="text-[10px] text-gray-500 font-semibold italic">Current Session</span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleToggleStatus(u.id, u.active)}
                            className={`inline-flex items-center gap-1 text-[10px] font-bold hover:underline ${
                              u.active ? "text-red-400 hover:text-red-300" : "text-emerald-400 hover:text-emerald-300"
                            }`}
                          >
                            <Power className="w-3 h-3" />
                            {u.active ? "Deactivate" : "Activate"}
                          </button>

                          <button
                            onClick={() => openDeleteModal(u)}
                            className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 font-bold hover:underline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative text-left">
            <button
              onClick={closeEditModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Users2 className="w-5 h-5 text-indigo-400" />
              Edit User Assignments
            </h3>
            <p className="text-xs text-gray-400">
              Modify name, role, and corresponding site or pump scopes for account <strong>@{editingUser.username}</strong>.
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
                <span>User assignment updated successfully!</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={editingUser.name}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  User Role
                </label>
                <select
                  name="role"
                  required
                  defaultValue={editingUser.role}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
                  // Dynamically update view (using standard uncontrolled component and key/state is fine)
                >
                  <option value="USER">User (Add-Only Requests & Readings)</option>
                  <option value="ADMIN">Admin (Full System Controls)</option>
                  <option value="ALLOCATOR">Allocator (Project Vehicle Manager)</option>
                  <option value="WORKSHOP">Workshop Pump Operator</option>
                  <option value="SITE_PUMP">Site Pump Operator (Site-Scoped)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project Assignment (Site-scoped roles: User / Site Pump)
                </label>
                <select
                  name="projectId"
                  defaultValue={editingUser.projectId || ""}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
                >
                  <option value="">No Project Scope (Global Pool)</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Bulk Tank Assignment (Workshop / Site Pump roles)
                </label>
                <select
                  name="bulkTankId"
                  defaultValue={editingUser.bulkTankId || ""}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none"
                >
                  <option value="">No Tank Scope</option>
                  {bulkTanks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.fuelKind})
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
                Save Assignments
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative text-left">
            <button
              onClick={closeResetModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-400" />
              Reset Password
            </h3>
            <p className="text-xs text-gray-400">
              Set a new login password for account <strong>@{resetUser.username}</strong>. The user will need to sign in again with the new password.
            </p>

            {resetError && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{resetError}</span>
              </div>
            )}

            {resetSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Password reset successfully!</span>
              </div>
            )}

            <form onSubmit={handleResetSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-amber-500/50 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Re-enter the password"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-amber-500/50 font-semibold"
                />
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Reset Password
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative text-left">
            <button
              onClick={closeDeleteModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Delete User
            </h3>
            <p className="text-xs text-gray-400">
              Permanently delete the account <strong>@{deletingUser.username}</strong> ({deletingUser.name})? This cannot be undone. Accounts that already have fuel, meter, billing or service history cannot be deleted — deactivate them instead to keep their records intact.
            </p>

            {deleteError && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={closeDeleteModal}
                disabled={isPending}
                className="flex-1 bg-white/5 hover:bg-white/10 text-gray-200 font-semibold py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
