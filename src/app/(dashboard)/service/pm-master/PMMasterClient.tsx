"use client";

import React, { useState } from "react";
import { addPMTaskAction, deletePMTaskAction } from "@/app/actions/service";
import { Plus, Trash2, Loader2, AlertCircle, Wrench, ChevronDown, Clock } from "lucide-react";

interface PMMasterClientProps {
  categories: { id: string; name: string; code: string; _count: { pmTasks: number; assets: number } }[];
  selectedCategoryId: string;
  tasks: {
    id: string;
    taskCode: string | null;
    intervalHours: number;
    intervalLabel: string;
    system: string | null;
    component: string | null;
    description: string;
    parts: string | null;
    laborHours: number | null;
    skill: string | null;
  }[];
  isAdmin: boolean;
}

export function PMMasterClient({
  categories,
  selectedCategoryId,
  tasks,
  isAdmin,
}: PMMasterClientProps) {
  const [openAdd, setOpenAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group tasks by interval
  const groupedTasks: Record<number, typeof tasks> = {};
  tasks.forEach((t) => {
    if (!groupedTasks[t.intervalHours]) groupedTasks[t.intervalHours] = [];
    groupedTasks[t.intervalHours].push(t);
  });

  const intervals = Object.keys(groupedTasks)
    .map(Number)
    .sort((a, b) => a - b);

  const handleAddTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await addPMTaskAction(fd);
      if (res.error) {
        setError(res.error);
      } else {
        setOpenAdd(false);
        window.location.reload();
      }
    } catch {
      setError("Failed to add task");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Remove this PM task from the category master?")) return;
    try {
      const res = await deletePMTaskAction(taskId, "");
      if (res.error) alert(res.error);
      else window.location.reload();
    } catch {
      alert("Failed to delete task");
    }
  };

  return (
    <div className="space-y-6">
      {/* Category Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121420] border border-white/5 rounded-2xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold text-gray-400">Select Category:</label>
          <div className="flex gap-1.5 flex-wrap">
            {categories.map((c) => (
              <a
                key={c.id}
                href={`/service/pm-master?category=${c.id}`}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  c.id === selectedCategoryId
                    ? "bg-indigo-600 text-white"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {c.name} ({c._count.pmTasks})
              </a>
            ))}
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={() => setOpenAdd(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
          >
            <Plus className="w-4 h-4" /> Add PM Task
          </button>
        )}
      </div>

      {/* Task Ladder */}
      {intervals.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-12 text-center text-xs text-gray-500">
          No preventive maintenance tasks configured for this category yet. Click &quot;Add PM Task&quot; above to create one.
        </div>
      ) : (
        <div className="space-y-6">
          {intervals.map((hrs) => {
            const list = groupedTasks[hrs];
            const label = list[0]?.intervalLabel || `Every ${hrs} Hours`;
            return (
              <div
                key={hrs}
                className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl"
              >
                <div className="bg-white/5 px-5 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <h3 className="font-bold text-white text-xs tracking-wide">
                      {label} ({hrs} h)
                    </h3>
                  </div>
                  <span className="text-[11px] text-gray-400">{list.length} tasks</span>
                </div>

                <div className="divide-y divide-white/5">
                  {list.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-white/[0.01]"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {task.taskCode && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300">
                              {task.taskCode}
                            </span>
                          )}
                          {task.system && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              {task.system}
                            </span>
                          )}
                          {task.component && (
                            <span className="text-[11px] text-gray-400">· {task.component}</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-white">{task.description}</p>
                        {task.parts && (
                          <p className="text-[11px] text-gray-400">
                            <span className="text-gray-500">Parts/Consumables:</span> {task.parts}
                          </p>
                        )}
                      </div>

                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all shrink-0"
                          title="Delete Task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Task Modal */}
      {openAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121420] border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white tracking-wide">
              Add Task to Category PM Master
            </h3>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleAddTask} className="space-y-4">
              <input type="hidden" name="categoryId" value={selectedCategoryId} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Interval Hours
                  </label>
                  <select
                    name="intervalHours"
                    required
                    defaultValue="250"
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="10">10 h (Daily)</option>
                    <option value="50">50 h (Weekly)</option>
                    <option value="250">250 h (Monthly / Initial)</option>
                    <option value="500">500 h (Standard PM)</option>
                    <option value="1000">1,000 h (Major PM)</option>
                    <option value="2000">2,000 h (Full Service)</option>
                    <option value="4000">4,000 h (Overhaul)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    System
                  </label>
                  <input
                    type="text"
                    name="system"
                    placeholder="Engine / Hydraulic / Brake"
                    className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Component
                </label>
                <input
                  type="text"
                  name="component"
                  placeholder="e.g. Engine Oil Filter or Air Cleaner"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Task Description
                </label>
                <textarea
                  name="description"
                  required
                  rows={2}
                  placeholder="e.g. Replace engine oil and engine oil filter element"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Parts & Consumables (Optional)
                </label>
                <input
                  type="text"
                  name="parts"
                  placeholder="e.g. 15W40 Oil (20L), Filter element #LF16015"
                  className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpenAdd(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
