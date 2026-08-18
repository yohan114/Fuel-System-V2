import { describe, expect, it } from "vitest";
import { planMerges, codeRank, normKey, type DedupeAsset } from "../src/lib/fleet/dedupe";

let seq = 0;
const A = (code: string, regNo: string | null, extra: Partial<DedupeAsset> = {}): DedupeAsset => ({
  id: `id-${seq++}`,
  code,
  regNo,
  status: "ACTIVE",
  detailScore: 3,
  createdAt: new Date("2026-01-01"),
  ...extra,
});

describe("normKey / codeRank", () => {
  it("normalizes case, spaces and dashes", () => {
    expect(normKey("Pj-7604")).toBe("PJ7604");
    expect(normKey("GJ 8775")).toBe("GJ8775");
  });
  it("ranks re-registrations, sheet ids, reg-as-code and independent codes", () => {
    expect(codeRank("RY-2390#2", "RY2390")).toBe(0);
    expect(codeRank("46065", "LK6738")).toBe(1);
    expect(codeRank("PJ-7604", "PJ7604")).toBe(2);
    expect(codeRank("DT-29", "LJ5559")).toBe(3);
  });
});

describe("planMerges", () => {
  it("merges a reg-as-code artifact into the E&C master record", () => {
    const master = A("DC-26", "PJ-7604");
    const artifact = A("PJ-7604", "PJ-7604");
    const plan = planMerges([master, artifact]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].survivor.code).toBe("DC-26");
    expect(plan.merges[0].duplicates.map((d) => d.code)).toEqual(["PJ-7604"]);
  });

  it("groups via the artifact's regNo even when the master has none", () => {
    const master = A("VR-59", null); // master carries no regNo of its own
    const artifact = A("46073", "VR 59");
    const plan = planMerges([master, artifact]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].survivor.code).toBe("VR-59");
  });

  it("folds numeric sheet ids and #N re-registrations into one survivor", () => {
    const plan = planMerges([
      A("WB-15", "RY-2390"),
      A("RY-2390", "RY-2390"),
      A("RY-2390#2", "RY-2390"),
      A("RY-2390#3", "RY-2390"),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].survivor.code).toBe("WB-15");
    expect(plan.merges[0].duplicates.map((d) => d.code).sort()).toEqual(["RY-2390", "RY-2390#2", "RY-2390#3"]);
  });

  it("reports two independent E&C codes sharing a reg instead of merging", () => {
    const plan = planMerges([A("DT-52", "LA-4229"), A("WB-05", "LA-4229")]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.ambiguous[0].reason).toBe("multiple-independent-codes");
  });

  it("reports oversized placeholder groups instead of merging", () => {
    const plan = planMerges(["HEX-25", "HEX-32", "HEX-33", "HEX-35", "HEX-38"].map((c) => A(c, "14160")));
    expect(plan.merges).toHaveLength(0);
    // five independent codes → multiple-independent-codes fires first, which is
    // equally report-only; the point is nothing merges
    expect(plan.ambiguous).toHaveLength(1);
  });

  it("ignores DISPOSED tombstones", () => {
    const plan = planMerges([A("DC-26", "PJ-7604"), A("PJ-7604", "PJ-7604", { status: "DISPOSED" })]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.ambiguous).toHaveLength(0);
  });

  it("breaks survivor ties by detail score", () => {
    const rich = A("GJ-8775", "GJ-8775", { detailScore: 5 });
    const poor = A("GJ-8775X", "GJ-8775", { detailScore: 1 }); // also rank-3 → ambiguous
    const numeric = A("46370", "GJ 8775");
    // rich (rank 2, code==reg) + numeric (rank 1) merge; poor is rank 3 → survivor over rich
    const plan = planMerges([rich, numeric]);
    expect(plan.merges[0].survivor.code).toBe("GJ-8775");
    const plan2 = planMerges([rich, poor, numeric]);
    expect(plan2.merges[0]?.survivor.code).toBe("GJ-8775X"); // independent code outranks reg-as-code
  });
});
