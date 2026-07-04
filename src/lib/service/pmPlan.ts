import { prisma } from "../db";

// Per-vehicle preventive-maintenance timeline, computed from the category's
// PM plan (Fleet PM Master). The plan is an hour ladder (250/500/1000/2000/
// 4000 h — daily/weekly items are routine checks, not milestones); road
// vehicles run the same ladder in kilometres at 10 km per plan hour, matching
// the app's existing 500 h ≈ 5,000 km service rule. A bigger service includes
// every smaller step that divides it (at 1,000 h you also do the 250 h and
// 500 h items), which is how the milestone task lists are built.

export const KM_PER_PLAN_HOUR = 10;
const MILESTONE_MIN_HOURS = 250;
const ROUTINE_DAILY_HOURS = 10;

export interface PMPlanTask {
  id: string;
  taskCode: string | null;
  intervalHours: number;
  intervalLabel: string;
  system: string | null;
  component: string | null;
  description: string;
  parts: string | null;
  skill: string | null;
  laborHours: number | null;
  notes: string | null;
}

export interface PMMilestone {
  atUnits: number; // absolute meter position (hr or km)
  planHours: number; // position on the plan ladder in hours
  stepHours: number; // largest ladder step due here (names the service)
  label: string; // e.g. "Quarterly / 500 h"
  dueInUnits: number; // atUnits − currentUnits
  isNext: boolean;
  tasks: PMPlanTask[];
}

// Pure milestone math, unit-tested separately from the DB wrapper.
export function upcomingMilestones(opts: {
  tasks: PMPlanTask[];
  currentUnits: number;
  unitFactor: number; // 1 for HOURS assets, KM_PER_PLAN_HOUR for KM
  count?: number;
}): PMMilestone[] {
  const { tasks, currentUnits, unitFactor, count = 5 } = opts;
  const scheduled = tasks.filter((t) => t.intervalHours >= MILESTONE_MIN_HOURS);
  if (scheduled.length === 0) return [];

  const steps = [...new Set(scheduled.map((t) => t.intervalHours))].sort((a, b) => a - b);
  const base = steps[0];
  const labelOf = new Map<number, string>();
  for (const t of scheduled) if (!labelOf.has(t.intervalHours)) labelOf.set(t.intervalHours, t.intervalLabel);

  const baseUnits = base * unitFactor;
  const firstN = Math.floor(Math.max(currentUnits, 0) / baseUnits) + 1;
  const milestones: PMMilestone[] = [];
  for (let n = firstN; milestones.length < count; n++) {
    const planHours = n * base;
    const due = scheduled.filter((t) => planHours % t.intervalHours === 0);
    const stepHours = Math.max(...due.map((t) => t.intervalHours));
    milestones.push({
      atUnits: planHours * unitFactor,
      planHours,
      stepHours,
      label: labelOf.get(stepHours) ?? `Every ${stepHours} h`,
      dueInUnits: planHours * unitFactor - currentUnits,
      isNext: milestones.length === 0,
      tasks: due,
    });
  }
  return milestones;
}

export interface AssetPMPlan {
  asset: { id: string; code: string; meterType: string; status: string; projectId: string | null };
  category: { id: string; name: string };
  unitLabel: "hr" | "km";
  unitFactor: number;
  currentUnits: number | null; // latest recorded meter; null = no reading yet
  milestones: PMMilestone[]; // positions assume 0 when no reading exists
  routine: { daily: PMPlanTask[]; weekly: PMPlanTask[] };
  ladder: { intervalHours: number; label: string; tasks: PMPlanTask[] }[]; // full plan for the adjust view
}

export async function getAssetPMPlan(code: string): Promise<AssetPMPlan | null> {
  const asset = await prisma.asset.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      meterType: true,
      status: true,
      projectId: true,
      category: { select: { id: true, name: true } },
    },
  });
  if (!asset) return null;

  const tasks = await prisma.pMTask.findMany({
    where: { categoryId: asset.category.id },
    orderBy: [{ intervalHours: "asc" }, { sortOrder: "asc" }],
  });

  const latest = await prisma.meterReading.findFirst({
    where: { assetId: asset.id },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
    select: { value: true },
  });
  const currentUnits = latest?.value ?? null;

  const unitFactor = asset.meterType === "KM" ? KM_PER_PLAN_HOUR : 1;
  const milestones = upcomingMilestones({ tasks, currentUnits: currentUnits ?? 0, unitFactor });

  const ladderSteps = [...new Set(tasks.map((t) => t.intervalHours))].sort((a, b) => a - b);
  const ladder = ladderSteps.map((h) => ({
    intervalHours: h,
    label: tasks.find((t) => t.intervalHours === h)?.intervalLabel ?? `Every ${h} h`,
    tasks: tasks.filter((t) => t.intervalHours === h),
  }));

  return {
    asset: { id: asset.id, code: asset.code, meterType: asset.meterType, status: asset.status, projectId: asset.projectId },
    category: asset.category,
    unitLabel: asset.meterType === "KM" ? "km" : "hr",
    unitFactor,
    currentUnits,
    milestones,
    routine: {
      daily: tasks.filter((t) => t.intervalHours === ROUTINE_DAILY_HOURS),
      weekly: tasks.filter((t) => t.intervalHours > ROUTINE_DAILY_HOURS && t.intervalHours < MILESTONE_MIN_HOURS),
    },
    ladder,
  };
}
