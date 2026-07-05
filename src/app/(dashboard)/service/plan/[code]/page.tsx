import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAssetPMPlan, type PMMilestone, type PMPlanTask } from "@/lib/service/pmPlan";
import { addPMTaskAction, deletePMTaskAction } from "@/app/actions/service";
import { ArrowLeft, CalendarClock, ClipboardCheck, ListChecks, Trash2, Wrench } from "lucide-react";

interface PageProps {
  params: Promise<{ code: string }>;
}

function fmtU(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default async function ServicePlanPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const { code: rawCode } = await props.params;
  const plan = await getAssetPMPlan(decodeURIComponent(rawCode).toUpperCase());
  if (!plan) redirect("/service");

  // Site users only see their own vehicles' plans.
  if (session.role === "USER" && session.projectId && plan.asset.projectId && plan.asset.projectId !== session.projectId) {
    redirect("/service");
  }

  const isAdmin = session.role === "ADMIN";
  const u = plan.unitLabel;
  const next = plan.milestones[0];
  const later = plan.milestones.slice(1);
  const routineTotal = plan.routine.daily.length + plan.routine.weekly.length;

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-4">
        <Link href="/service" className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 mb-1">
          <ArrowLeft className="w-3 h-3" /> Service Planner
        </Link>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-indigo-400" /> {plan.asset.code} — Service Plan
          <span className="text-[10px] text-gray-500 mt-1">{plan.category.name}</span>
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          {plan.currentUnits != null
            ? <>Current meter: <span className="text-white font-semibold">{fmtU(plan.currentUnits)} {u}</span>.</>
            : "No meter reading recorded yet — the timeline starts from zero."}{" "}
          Milestones follow the PM Master ladder{plan.unitFactor > 1 ? ` (road vehicles: 10 km per plan hour, so a 500 h service falls every ${fmtU(500 * plan.unitFactor)} km)` : ""}; a bigger service includes all smaller-interval tasks.
        </p>
      </div>

      {plan.milestones.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-10 text-center text-xs text-gray-500">
          No PM plan exists for the {plan.category.name} category. Run <code className="text-gray-400">scripts/import_pm_master.ts</code> or add tasks below.
        </div>
      ) : (
        <>
          {/* Timeline */}
          <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-5 border-b border-white/5 pb-2 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-indigo-400" /> Upcoming services
            </h3>
            <div className="flex items-stretch gap-0 min-w-[640px]">
              {plan.milestones.map((m, i) => (
                <div key={m.atUnits} className="flex-1 relative">
                  {i < plan.milestones.length - 1 && <div className="absolute top-[9px] left-1/2 w-full h-0.5 bg-white/10" aria-hidden="true" />}
                  <div className="relative flex flex-col items-center text-center gap-1.5 px-2">
                    <span className={`w-[18px] h-[18px] rounded-full border-4 ${m.isNext ? "bg-indigo-400 border-indigo-500/30" : "bg-[#1b1e30] border-white/10"}`} />
                    {m.isNext && <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">Next</span>}
                    <span className="text-sm font-bold text-white">{fmtU(m.atUnits)} {u}</span>
                    <span className="text-[10px] text-gray-400">{m.label}</span>
                    <span className="text-[10px] text-gray-500">{m.tasks.length} tasks · in {fmtU(m.dueInUnits)} {u}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Next service — what to do */}
          {next && (
            <div className="bg-[#121420] border border-indigo-500/20 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 border-b border-white/5 pb-2 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-indigo-400" />
                Next service at {fmtU(next.atUnits)} {u} — {next.label} · {next.tasks.length} tasks
                {(() => {
                  const labor = next.tasks.reduce((s, t) => s + (t.laborHours ?? 0), 0);
                  return labor > 0 ? <span className="text-gray-500 normal-case font-normal">≈ {labor.toFixed(1)} labor h</span> : null;
                })()}
              </h3>
              <MilestoneTasks milestone={next} />
            </div>
          )}

          {/* Later milestones */}
          {later.length > 0 && (
            <div className="space-y-2">
              {later.map((m) => (
                <details key={m.atUnits} className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
                  <summary className="cursor-pointer px-5 py-4 text-xs font-semibold text-gray-300 hover:text-white flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-gray-500" />
                    At {fmtU(m.atUnits)} {u} — {m.label} · {m.tasks.length} tasks
                  </summary>
                  <div className="px-5 pb-5 overflow-x-auto"><MilestoneTasks milestone={m} /></div>
                </details>
              ))}
            </div>
          )}
        </>
      )}

      {/* Routine checks */}
      {routineTotal > 0 && (
        <details className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden">
          <summary className="cursor-pointer px-5 py-4 text-xs font-semibold text-gray-300 hover:text-white flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-emerald-400" />
            Routine checks — daily ({plan.routine.daily.length}) &amp; weekly ({plan.routine.weekly.length}) — done by the operator, not scheduled on the timeline
          </summary>
          <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <RoutineList title="Daily / 10 h" tasks={plan.routine.daily} />
            <RoutineList title="Weekly / 50 h" tasks={plan.routine.weekly} />
          </div>
        </details>
      )}

      {/* Adjust plan (admin) */}
      {isAdmin && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-400" /> Adjust plan
            <span className="text-gray-500 normal-case font-normal">changes apply to every {plan.category.name} vehicle</span>
          </h3>

          <form
            action={async (fd) => {
              "use server";
              await addPMTaskAction(fd);
            }}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2"
          >
            <input type="hidden" name="categoryId" value={plan.category.id} />
            <input type="hidden" name="assetCode" value={plan.asset.code} />
            <select name="intervalHours" required defaultValue={250} className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs">
              {[10, 50, 250, 500, 1000, 2000, 4000].map((h) => (
                <option key={h} value={h}>
                  {plan.ladder.find((l) => l.intervalHours === h)?.label ?? `Every ${h} h`}
                </option>
              ))}
            </select>
            <input type="text" name="system" placeholder="System e.g. Engine" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="text" name="component" placeholder="Component" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <input type="text" name="description" required placeholder="Task e.g. Replace air filter" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs md:col-span-2" />
            <input type="text" name="parts" placeholder="Parts / consumables" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2 col-span-2 md:col-span-1">Add task</button>
          </form>

          <div className="space-y-2">
            {plan.ladder.map((step) => (
              <details key={step.intervalHours} className="bg-[#1b1e30] border border-white/5 rounded-xl overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-gray-300 hover:text-white">
                  {step.label} — {step.tasks.length} tasks
                </summary>
                <div className="px-4 pb-4 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <tbody className="divide-y divide-white/5">
                      {step.tasks.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2 text-gray-500 w-24">{t.system ?? "—"}</td>
                          <td className="py-2 text-gray-300">{t.description}{t.component ? <span className="text-gray-500"> · {t.component}</span> : null}</td>
                          <td className="py-2 text-gray-500 max-w-[220px] truncate" title={t.parts ?? ""}>{t.parts ?? "—"}</td>
                          <td className="py-2 text-right w-10">
                            <form
                              action={async () => {
                                "use server";
                                await deletePMTaskAction(t.id, plan.asset.code);
                              }}
                            >
                              <button type="submit" className="text-gray-600 hover:text-rose-400" title="Remove task from the category plan">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MilestoneTasks({ milestone }: { milestone: PMMilestone }) {
  const systems = [...new Set(milestone.tasks.map((t) => t.system ?? "General"))];
  return (
    <div className="space-y-4">
      {systems.map((sys) => (
        <div key={sys}>
          <h4 className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider mb-1.5">{sys}</h4>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 font-semibold border-b border-white/5">
                <th className="py-1.5 w-44">Component</th>
                <th className="py-1.5">What to do</th>
                <th className="py-1.5 w-64">Parts / consumables</th>
                <th className="py-1.5 text-right w-16">Labor h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {milestone.tasks.filter((t) => (t.system ?? "General") === sys).map((t) => (
                <tr key={t.id} className="hover:bg-white/[0.01]" title={t.notes ?? ""}>
                  <td className="py-2 text-gray-400">{t.component ?? "—"}</td>
                  <td className="py-2 text-gray-200">{t.description}</td>
                  <td className="py-2 text-gray-500">{t.parts ?? "—"}</td>
                  <td className="py-2 text-right text-gray-500">{t.laborHours != null ? t.laborHours.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function RoutineList({ title, tasks }: { title: string; tasks: PMPlanTask[] }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider mb-1.5">{title}</h4>
      <ul className="space-y-1">
        {tasks.map((t) => (
          <li key={t.id} className="text-xs text-gray-400">
            <span className="text-gray-600">•</span> {t.description}
            {t.parts ? <span className="text-gray-600"> ({t.parts})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
