import { describe, expect, it } from "vitest";
import { upcomingMilestones, KM_PER_PLAN_HOUR, type PMPlanTask } from "../src/lib/service/pmPlan";

let seq = 0;
const T = (intervalHours: number, description = `task-${intervalHours}-${seq++}`): PMPlanTask => ({
  id: `t-${seq}`,
  taskCode: `X-${seq}`,
  intervalHours,
  intervalLabel: `Every ${intervalHours} h`,
  system: "Engine",
  component: null,
  description,
  parts: null,
  skill: null,
  laborHours: 0.5,
  notes: null,
});

const LADDER = [T(10), T(50), T(250, "engine oil"), T(500, "pinion oil"), T(1000, "coolant flush"), T(2000, "injectors"), T(4000, "overhaul")];

describe("upcomingMilestones", () => {
  it("schedules the next milestone above the current meter (hours asset)", () => {
    const ms = upcomingMilestones({ tasks: LADDER, currentUnits: 520, unitFactor: 1, count: 3 });
    expect(ms.map((m) => m.atUnits)).toEqual([750, 1000, 1250]);
    expect(ms[0].isNext).toBe(true);
  });

  it("a bigger service includes all smaller-interval tasks", () => {
    const ms = upcomingMilestones({ tasks: LADDER, currentUnits: 900, unitFactor: 1, count: 1 });
    const at1000 = ms[0];
    expect(at1000.atUnits).toBe(1000);
    expect(at1000.stepHours).toBe(1000);
    const names = at1000.tasks.map((t) => t.description);
    expect(names).toContain("engine oil"); // 250 divides 1000
    expect(names).toContain("pinion oil"); // 500 divides 1000
    expect(names).toContain("coolant flush");
    expect(names).not.toContain("injectors"); // 2000 does not divide 1000
  });

  it("excludes daily/weekly routine checks from milestones", () => {
    const ms = upcomingMilestones({ tasks: LADDER, currentUnits: 0, unitFactor: 1, count: 1 });
    expect(ms[0].tasks.every((t) => t.intervalHours >= 250)).toBe(true);
  });

  it("runs the same ladder in km for road vehicles (10 km per plan hour)", () => {
    const ms = upcomingMilestones({ tasks: LADDER, currentUnits: 54_320, unitFactor: KM_PER_PLAN_HOUR, count: 2 });
    expect(ms[0].atUnits).toBe(55_000); // 5,500 plan-h → quarterly (500 divides 5,500)
    expect(ms[0].stepHours).toBe(500);
    expect(ms[0].dueInUnits).toBe(680);
    expect(ms[1].atUnits).toBe(57_500);
  });

  it("names the milestone after the largest step due there", () => {
    const ms = upcomingMilestones({ tasks: LADDER, currentUnits: 3900, unitFactor: 1, count: 1 });
    expect(ms[0].atUnits).toBe(4000);
    expect(ms[0].stepHours).toBe(4000);
    expect(ms[0].tasks.map((t) => t.description)).toContain("overhaul");
  });

  it("returns nothing when the category has no scheduled tasks", () => {
    expect(upcomingMilestones({ tasks: [T(10), T(50)], currentUnits: 100, unitFactor: 1 })).toEqual([]);
  });
});
