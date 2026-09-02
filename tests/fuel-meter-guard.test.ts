// What a fuel meter reading is judged against.
//
// The defect: the check compared a new fuel reading against the machine's
// HIGHEST reading of ANY source. Both halves of that were wrong.
//
// Service readings come from WorkshopOne's meter column, typed by hand for
// three years, and are a different instrument read by a different person.
// 132 machines in this fleet had a SERVICE reading as their highest, and most
// of them had no fuel readings at all — so on those, an operator entering the
// correct figure off the dashboard was refused, with a message telling them
// their reading was wrong when the stored one was.
//
// And "highest" is not "latest". DT-64 carried 39,883 km from a 2023 service
// while the truck actually reads 19,499, so every correct entry for that
// machine would have been rejected for good. A replaced meter legitimately
// restarts low, and ordering by value can never see that.

import { describe, expect, it } from "vitest";
import { judgeFuelMeter } from "../src/lib/fuel/meter-guard";

const on = (iso: string) => new Date(iso);

describe("judgeFuelMeter", () => {
  it("accepts a machine's first fuel reading, whatever the number", () => {
    // Nothing of the same kind to compare with. This is the DT-64 case: its
    // only readings were services, so under the old rule 39,883 became the
    // floor and no real entry could clear it.
    expect(judgeFuelMeter(19499, null).ok).toBe(true);
    expect(judgeFuelMeter(1, null).ok).toBe(true);
  });

  it("accepts a reading that moves forward", () => {
    expect(judgeFuelMeter(310887, { value: 310379, on: on("2026-08-11") }).ok).toBe(true);
  });

  it("accepts a reading equal to the last one", () => {
    // A machine fuelled twice in a day without moving. Common, and not an error.
    expect(judgeFuelMeter(5354, { value: 5354, on: on("2026-08-11") }).ok).toBe(true);
  });

  it("refuses a reading below the last fuel reading", () => {
    const r = judgeFuelMeter(310508, { value: 310887, on: on("2026-08-20") });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot go backwards/);
  });

  it("names the reading it judged against, so the operator can check it", () => {
    const r = judgeFuelMeter(100, { value: 500, on: on("2026-08-20") });
    expect(r.error).toContain("500");
    expect(r.error).toContain("2026-08-20");
  });

  it("tells the operator what to do when a meter has been replaced", () => {
    // The one legitimate reason a reading drops. Refusing without saying so
    // leaves them retyping a correct number until they give up.
    const r = judgeFuelMeter(90, { value: 21088, on: on("2025-08-13") });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/replaced/i);
  });
});
