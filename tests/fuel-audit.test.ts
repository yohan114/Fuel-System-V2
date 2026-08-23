// What the log has to be able to answer.
//
// It already recorded that an issue was edited, as a sentence: "litres from 40L
// to 60L". Readable, and no help six months later — it did not say what the
// price had been, which tank gave up the twenty litres, or which bill moved.
// Of 1,055 fuel-issue audit rows only 20 carried any structured payload, so
// "what did this row say before I touched it" had no answer.
//
// The rule these tests hold: the payload records every field that moved with
// both its values, and the sentence is generated from that same payload so the
// two cannot drift.

import { describe, expect, it } from "vitest";
import { diffSnapshots, summarise, periodKeyFor, type FuelIssueSnapshot } from "../src/lib/fuel/audit";

const base: FuelIssueSnapshot = {
  assetId: "a1",
  assetCode: "HEX-45",
  fuelKind: "AUTO_DIESEL",
  litres: 40,
  meterReading: 1200,
  readingType: "HOURS",
  pricePerLitre: 38700,
  totalCost: 1548000,
  source: "Badalgama Tank",
  issueDate: new Date("2026-08-14T04:00:00.000Z"),
  bulkTankId: "t1",
  voided: false,
};

describe("what changed", () => {
  it("says nothing when nothing moved", () => {
    expect(diffSnapshots(base, { ...base })).toEqual([]);
  });

  it("reports only the fields that moved", () => {
    const after = { ...base, litres: 60, totalCost: 2322000 };
    const d = diffSnapshots(base, after);
    expect(d.map((c) => c.field).sort()).toEqual(["litres", "totalCost"]);
    expect(d.find((c) => c.field === "litres")).toEqual({ field: "litres", from: 40, to: 60 });
  });

  it("compares dates by instant, not by object", () => {
    const after = { ...base, issueDate: new Date(base.issueDate.getTime()) };
    expect(diffSnapshots(base, after)).toEqual([]);
  });

  it("catches a date that really moved, and serialises both ends", () => {
    const after = { ...base, issueDate: new Date("2026-08-15T04:00:00.000Z") };
    const d = diffSnapshots(base, after);
    expect(d).toHaveLength(1);
    expect(d[0].from).toBe("2026-08-14T04:00:00.000Z");
    expect(d[0].to).toBe("2026-08-15T04:00:00.000Z");
  });

  it("records a meter reading being cleared", () => {
    const d = diffSnapshots(base, { ...base, meterReading: null });
    expect(d).toEqual([{ field: "meterReading", from: 1200, to: null }]);
  });

  it("records a machine being reassigned", () => {
    const d = diffSnapshots(base, { ...base, assetCode: "HEX-46" });
    expect(d).toEqual([{ field: "assetCode", from: "HEX-45", to: "HEX-46" }]);
  });

  it("records a void as the field it is", () => {
    const d = diffSnapshots(base, { ...base, voided: true });
    expect(d).toEqual([{ field: "voided", from: false, to: true }]);
  });
});

describe("the sentence comes from the payload", () => {
  it("names every field that moved, not a chosen few", () => {
    const changes = diffSnapshots(base, { ...base, litres: 60, totalCost: 2322000, source: "Station" });
    const s = summarise({ action: "UPDATE", issueId: "i1", changes }, "HEX-45");
    expect(s).toContain("litres 40 → 60");
    expect(s).toContain("cost 1548000 → 2322000");
    expect(s).toContain("source Badalgama Tank → Station");
  });

  it("states the tank movement in the direction it went", () => {
    const back = summarise(
      { action: "VOID", issueId: "i1", changes: [], tankDeltaLitres: 60, tankName: "Badalgama Tank" },
      "HEX-45",
    );
    expect(back).toContain("returned 60 L to Badalgama Tank");
    const out = summarise(
      { action: "UPDATE", issueId: "i1", changes: [], tankDeltaLitres: -20, tankName: "Badalgama Tank" },
      "HEX-45",
    );
    expect(out).toContain("drew 20 L from Badalgama Tank");
  });

  it("names the month whose bill has to be redone", () => {
    expect(summarise({ action: "VOID", issueId: "i1", changes: [], periodKey: "2026-08" }, "HEX-45"))
      .toContain("affects 2026-08");
  });

  it("carries the reason where one was given", () => {
    expect(summarise({ action: "VOID", issueId: "i1", changes: [], reason: "double entry" }, "HEX-45"))
      .toContain("reason: double entry");
  });

  it("still says something when only the action is known", () => {
    expect(summarise({ action: "CREATE", issueId: "i1", changes: [] }, "HEX-45"))
      .toBe("Recorded fuel issue for HEX-45");
  });

  it("shows dates as Colombo days, not as raw timestamps", () => {
    const changes = diffSnapshots(base, { ...base, issueDate: new Date("2026-08-15T04:00:00.000Z") });
    const s = summarise({ action: "UPDATE", issueId: "i1", changes }, "HEX-45");
    expect(s).toContain("date 2026-08-14 → 2026-08-15");
  });
});

describe("which month a change lands in", () => {
  it("uses the Colombo day, so the 1st is not last month", () => {
    // A Colombo 1 August is stored at 18:30Z on 31 July. Bucketing on the raw
    // UTC month would file it under July and regenerate the wrong bill.
    expect(periodKeyFor(new Date("2026-07-31T18:30:00.000Z"))).toBe("2026-08");
    expect(periodKeyFor(new Date("2026-07-31T18:29:00.000Z"))).toBe("2026-07");
  });

  it("handles a mid-month afternoon without drama", () => {
    expect(periodKeyFor(new Date("2026-08-14T04:00:00.000Z"))).toBe("2026-08");
  });
});
