// Meter movement counted step by step, not last-minus-first.
//
// The site summary bill took the ends of the window and subtracted them. One
// mis-keyed reading then landed whole in the answer, and the page said things
// no one could defend across a table:
//
//   TM-18   read 0 on 3 June and 462,531 on the 26th
//           → 462,531 hours × Rs 3,050 = Rs 1,410,719,550 on one line
//   FL-01   47,893 on 10 July, 483,405 on the 27th (a digit added)
//           → Rs 391,960,800
//   SC-10   264,174 keyed as 2,641,740
//           → 2,378,690 km in a 30-day month
//
// Badalgama's June summary came to Rs 2.3 billion against a whole-company month
// of Rs 77 million. The bills for the same machines were right all along — the
// billing engine already refuses a series it cannot defend — so this is the
// summary catching up with a rule the rest of the system had.
//
// The rule: a step counts when it goes forward and stays inside a day's travel
// for the days it spans. 24 hours a day, 1,500 km a day — the same bounds the
// asset merge tool uses to decide whether two records could be one machine.

import { describe, expect, it } from "vitest";
import { coherentMeterDelta } from "../src/lib/billing/usage";

const d = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const r = (day: string, value: number) => ({ readingDate: d(day), value });

describe("ordinary series", () => {
  it("sums a month of plausible steps", () => {
    expect(coherentMeterDelta([r("2026-06-01", 1000), r("2026-06-10", 1080), r("2026-06-20", 1150)], "HOURS")).toBe(150);
  });

  it("reads zero movement as zero, not as unread", () => {
    expect(coherentMeterDelta([r("2026-06-01", 500), r("2026-06-30", 500)], "HOURS")).toBe(0);
  });

  it("has nothing to say about a single reading", () => {
    expect(coherentMeterDelta([r("2026-06-01", 500)], "HOURS")).toBeNull();
  });

  it("has nothing to say about an empty window", () => {
    expect(coherentMeterDelta([], "HOURS")).toBeNull();
  });

  it("does not depend on the order it is given", () => {
    const asc = [r("2026-06-01", 100), r("2026-06-05", 150), r("2026-06-09", 190)];
    expect(coherentMeterDelta([...asc].reverse(), "HOURS")).toBe(coherentMeterDelta(asc, "HOURS"));
  });
});

describe("the keying slips this exists for", () => {
  it("refuses TM-18: a meter reading 0, then 462,531 twenty-three days later", () => {
    // 24 h/day × 23 days = 552 hours is the most it could have recorded.
    expect(coherentMeterDelta([r("2026-06-03", 0), r("2026-06-26", 462531)], "HOURS")).toBeNull();
  });

  it("refuses FL-01: 47,893 then 483,405, a digit added", () => {
    expect(coherentMeterDelta([r("2026-07-10", 47893), r("2026-07-27", 483405)], "HOURS")).toBeNull();
  });

  it("keeps the good steps around a spike and drops the spike", () => {
    // HEX-33: +3 hours over nine days is real; 8,802 → 88,055 overnight is not.
    expect(coherentMeterDelta([r("2026-06-09", 8799), r("2026-06-18", 8802), r("2026-06-19", 88055)], "HOURS")).toBe(3);
  });

  it("drops both sides of a spike — the way back down is negative", () => {
    const series = [r("2026-06-01", 1000), r("2026-06-05", 1040), r("2026-06-06", 10400), r("2026-06-07", 1050)];
    expect(coherentMeterDelta(series, "HOURS")).toBe(40);
  });

  it("refuses SC-10's 2,641,740 for 264,174", () => {
    expect(coherentMeterDelta([r("2026-06-09", 263050), r("2026-06-25", 2641740)], "KM")).toBeNull();
  });

  it("ignores a reading that goes backwards", () => {
    expect(coherentMeterDelta([r("2026-06-01", 5000), r("2026-06-10", 4000), r("2026-06-20", 4100)], "KM")).toBe(100);
  });
});

describe("the day's allowance", () => {
  it("lets a lorry cover 1,500 km in a day", () => {
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-02", 1500)], "KM")).toBe(1500);
  });

  it("refuses 1,501 km in the same day", () => {
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-02", 1501)], "KM")).toBeNull();
  });

  it("allows 24 hours a day and no more", () => {
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-03", 48)], "HOURS")).toBe(48);
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-03", 49)], "HOURS")).toBeNull();
  });

  it("gives two readings on one day a full day's allowance", () => {
    const morning = { readingDate: new Date("2026-06-01T02:00:00+05:30"), value: 100 };
    const evening = { readingDate: new Date("2026-06-01T18:00:00+05:30"), value: 110 };
    expect(coherentMeterDelta([morning, evening], "HOURS")).toBe(10);
  });

  it("treats an unknown meter type on the tighter hourly allowance", () => {
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-02", 20)], null)).toBe(20);
    expect(coherentMeterDelta([r("2026-06-01", 0), r("2026-06-02", 900)], null)).toBeNull();
  });
});
