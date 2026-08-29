import { describe, it, expect } from "vitest";
import {
  RATE_FILTERS, asRateFilter, filterRateRows, describeRateQuery,
} from "../src/lib/consumption/rates-filter";
import {
  buildRatesTableSheet, buildRatesTableWorkbook, ratesTableFilename,
} from "../src/lib/reports/rates-workbook";
import type { RateBandRow } from "../src/lib/consumption/rates-overview";

function row(over: Partial<RateBandRow> = {}): RateBandRow {
  return {
    assetId: "a1", code: "HCC-06", regNo: "PH-6744", typeLabel: "Paver",
    categoryName: "Asphalt Paver", projectName: "Awissawella", status: "ACTIVE",
    meterType: "KM", hasRateCard: true,
    econ: 0.082, typ: 0.105, heavy: 0.132, basis: "km",
    econDisplay: 12.2, typDisplay: 9.5, heavyDisplay: 7.6, unit: "km/L",
    comparable: true, bandReason: "ok",
    actualDisplay: 5.6, intervals: 6, state: "OVER", severity: 1.68,
    totalLitres: 900, emptyReason: null,
    chargeMode: "perkm", dryCents: 4_500, wetCents: 7_000, fullyWetCents: 11_500,
    defaultBasis: "w", equipType: "FLEET",
    ...over,
  };
}

const sheetOf = (rows: RateBandRow[], note = "All 1 machines") =>
  buildRatesTableSheet({
    rows, scopeNote: note,
    generatedAt: new Date("2026-08-25T04:00:00Z"), exportedBy: "Administrator",
  });

const headerRow = (aoa: (string | number | null)[][]) => aoa.findIndex((r) => r[0] === "Machine");

describe("the table filter, shared by the screen and the export", () => {
  const rows = [
    row({ assetId: "a1", code: "HCC-06", regNo: "PH-6744", state: "OVER", intervals: 6, bandReason: "ok", categoryName: "Asphalt Paver", projectName: "Awissawella" }),
    row({ assetId: "a2", code: "DT-83", regNo: "LP-1712", state: "HEAVY", intervals: 4, bandReason: "ok", categoryName: "Dump Truck", projectName: "Badalgama" }),
    row({ assetId: "a3", code: "LB-22", regNo: null, state: "NORMAL", intervals: 5, bandReason: "ok", categoryName: "Backhoe Loader", projectName: null }),
    row({ assetId: "a4", code: "GE-62", regNo: null, state: null, intervals: 0, bandReason: "no-band", categoryName: "Generator", projectName: "Awissawella" }),
    row({ assetId: "a5", code: "VR-54", regNo: null, state: null, intervals: 0, bandReason: "no-rate-card", categoryName: "Vibrating Roller", projectName: null }),
    row({ assetId: "a6", code: "DC-21", regNo: "PH-3945", state: null, intervals: 2, bandReason: "basis-conflict", categoryName: "Double Cab", projectName: "Badalgama" }),
  ];

  it("offers the same six filters the screen does", () => {
    expect(RATE_FILTERS.map((f) => f.key)).toEqual(["all", "over", "measured", "no-band", "conflict", "no-card"]);
  });

  it("filters exactly as each chip is labelled", () => {
    const codes = (f: Parameters<typeof filterRateRows>[1]) => filterRateRows(rows, f).map((r) => r.code);
    expect(codes({ filter: "all" })).toHaveLength(6);
    // "Over standard" is both states, which is what the tile counts too.
    expect(codes({ filter: "over" })).toEqual(["HCC-06", "DT-83"]);
    expect(codes({ filter: "measured" })).toEqual(["HCC-06", "DT-83", "LB-22", "DC-21"]);
    expect(codes({ filter: "no-band" })).toEqual(["GE-62"]);
    expect(codes({ filter: "conflict" })).toEqual(["DC-21"]);
    expect(codes({ filter: "no-card" })).toEqual(["VR-54"]);
  });

  it("searches code, plate, category and site", () => {
    expect(filterRateRows(rows, { q: "dt-" }).map((r) => r.code)).toEqual(["DT-83"]);
    expect(filterRateRows(rows, { q: "ph-6744" }).map((r) => r.code)).toEqual(["HCC-06"]);
    expect(filterRateRows(rows, { q: "dump" }).map((r) => r.code)).toEqual(["DT-83"]);
    expect(filterRateRows(rows, { q: "badalgama" }).map((r) => r.code)).toEqual(["DT-83", "DC-21"]);
  });

  it("ignores case and surrounding space, as typing into the box does", () => {
    // Substring, case-insensitive, trimmed — a trailing space from a paste must
    // not turn a hit into a miss.
    expect(filterRateRows(rows, { q: "  HcC  " }).map((r) => r.code)).toEqual(["HCC-06"]);
    expect(filterRateRows(rows, { q: "  hcc-06 " }).map((r) => r.code)).toEqual(["HCC-06"]);
    expect(filterRateRows(rows, { q: "   " }).map((r) => r.code)).toHaveLength(6);
  });

  it("applies the filter and the search together", () => {
    expect(filterRateRows(rows, { filter: "over", q: "dump" }).map((r) => r.code)).toEqual(["DT-83"]);
    expect(filterRateRows(rows, { filter: "over", q: "generator" })).toEqual([]);
  });

  it("keeps the screen's order — it never re-sorts", () => {
    expect(filterRateRows(rows, {}).map((r) => r.code)).toEqual(rows.map((r) => r.code));
  });

  it("treats a stale or hostile filter parameter as All rather than erroring", () => {
    expect(asRateFilter("over")).toBe("over");
    expect(asRateFilter("nonsense")).toBe("all");
    expect(asRateFilter(null)).toBe("all");
    expect(asRateFilter("")).toBe("all");
    expect(asRateFilter("__proto__")).toBe("all");
  });

  it("says on the sheet which rows it is carrying", () => {
    expect(describeRateQuery({}, 770, 770)).toBe("All 770 machines");
    expect(describeRateQuery({ filter: "over" }, 20, 770)).toBe("20 of 770 machines — filter “Over standard”");
    expect(describeRateQuery({ q: "DT" }, 91, 770)).toBe("91 of 770 machines — search “DT”");
    expect(describeRateQuery({ filter: "over", q: "DT" }, 6, 770))
      .toBe("6 of 770 machines — filter “Over standard”, search “DT”");
  });

  it("truncates an absurd search term rather than echoing it into a cell", () => {
    const note = describeRateQuery({ q: "x".repeat(7000) }, 0, 770);
    expect(note.length).toBeLessThan(200);
    expect(note).toContain("…");
    // A normal term is echoed whole.
    expect(describeRateQuery({ q: "x".repeat(120) }, 0, 770)).not.toContain("…");
  });
});

describe("the extracted filter still behaves exactly as the in-component one did", () => {
  // Verbatim copy of the predicate as it stood inside RatesTable.tsx before it
  // was lifted into rates-filter.ts, kept here as the reference implementation.
  // If the shared version ever diverges, the screen's behaviour changed without
  // anybody deciding it should.
  function original(rows: RateBandRow[], q: string, filter: string): RateBandRow[] {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "over" && r.state !== "OVER" && r.state !== "HEAVY") return false;
      if (filter === "measured" && r.intervals === 0) return false;
      if (filter === "no-band" && r.bandReason !== "no-band") return false;
      if (filter === "conflict" && r.bandReason !== "basis-conflict") return false;
      if (filter === "no-card" && r.bandReason !== "no-rate-card") return false;
      if (!term) return true;
      return (
        r.code.toLowerCase().includes(term) ||
        (r.regNo ?? "").toLowerCase().includes(term) ||
        (r.categoryName ?? "").toLowerCase().includes(term) ||
        (r.projectName ?? "").toLowerCase().includes(term)
      );
    });
  }

  // A row set built to hit every branch, including the null fields.
  const states = ["OVER", "HEAVY", "NORMAL", "BELOW_ECON", null] as const;
  const reasons = ["ok", "no-band", "basis-conflict", "no-rate-card"];
  const corpus: RateBandRow[] = [];
  let n = 0;
  for (const state of states) {
    for (const bandReason of reasons) {
      for (const intervals of [0, 3]) {
        n++;
        corpus.push(row({
          assetId: `x${n}`,
          code: n % 3 === 0 ? `DT-${n}` : `LB-${n}`,
          regNo: n % 4 === 0 ? null : `PH-${1000 + n}`,
          categoryName: n % 5 === 0 ? null : n % 2 ? "Dump Truck" : "Backhoe Loader",
          projectName: n % 7 === 0 ? null : n % 2 ? "Awissawella" : "Badalgama",
          state, bandReason, intervals,
        }));
      }
    }
  }

  const TERMS = ["", "  ", "dt", "DT-", "ph-", "dump", "badal", "AWISSAWELLA", "zzz", "-", "6"];

  it("returns the same rows for every filter and search combination", () => {
    expect(corpus).toHaveLength(40);
    for (const { key } of RATE_FILTERS) {
      for (const q of TERMS) {
        const mine = filterRateRows(corpus, { q, filter: key }).map((r) => r.assetId);
        const theirs = original(corpus, q, key).map((r) => r.assetId);
        expect(mine, `filter=${key} q="${q}"`).toEqual(theirs);
      }
    }
  });

  it("covers every branch — the corpus is not accidentally trivial", () => {
    // A test that always compares two empty arrays proves nothing.
    const sizes = RATE_FILTERS.map(({ key }) => filterRateRows(corpus, { filter: key }).length);
    expect(sizes.every((s) => s > 0)).toBe(true);
    expect(new Set(sizes).size).toBeGreaterThan(1);
    expect(filterRateRows(corpus, { q: "zzz" })).toHaveLength(0);
    expect(corpus.some((r) => r.regNo === null)).toBe(true);
    expect(corpus.some((r) => r.categoryName === null)).toBe(true);
    expect(corpus.some((r) => r.projectName === null)).toBe(true);
  });
});

describe("the one-page sheet", () => {
  it("is a single sheet named for the section", () => {
    const wb = buildRatesTableWorkbook({
      rows: [row()], scopeNote: "All 1 machines",
      generatedAt: new Date("2026-08-25T04:00:00Z"), exportedBy: "Administrator",
    });
    expect(wb.SheetNames).toEqual(["Fuel & Rental Rates"]);
    const ws = wb.Sheets["Fuel & Rental Rates"];
    const header = buildRatesTableSheet({
      rows: [row()], scopeNote: "All 1 machines",
      generatedAt: new Date("2026-08-25T04:00:00Z"), exportedBy: "Administrator",
    });
    // A width for every column, however many there are.
    expect(ws["!cols"]).toHaveLength(header.aoa[headerRow(header.aoa)].length);
  });

  it("carries the screen's columns in the screen's order", () => {
    const s = sheetOf([row()]);
    expect(s.aoa[headerRow(s.aoa)]).toEqual([
      "Machine", "Reg No", "Category",
      "Econ", "Standard", "Heavy", "Unit",
      "Actual", "Actual Unit", "Intervals", "Verdict", "Severity (×)",
      "Rate Unit", "Dry (LKR)", "Wet (LKR)", "Fully Wet (LKR)", "Bills On",
    ]);
  });

  it("labels the Actual figure from the meter, so the cell is never bare", () => {
    // The Unit column states the BAND's unit and is blank where there is no
    // band — but Actual is measured from the meter regardless. Without its own
    // unit, 19 of 770 rows exported a number that is L/hr on one line and km/L
    // on the next with nothing to tell them apart.
    const s = sheetOf([
      row({ assetId: "a1", code: "DAI-4487", meterType: "KM", typ: null, typDisplay: null, bandReason: "no-rate-card", hasRateCard: false, actualDisplay: 12.69, state: null, severity: 0 }),
      row({ assetId: "a2", code: "GEN-KB", meterType: "HOURS", typ: null, typDisplay: null, bandReason: "no-rate-card", hasRateCard: false, actualDisplay: 9.95, state: null, severity: 0 }),
    ]);
    const h = headerRow(s.aoa);
    const head = s.aoa[h] as string[];
    const at = (r: number, c: string) => s.aoa[h + 1 + r][head.indexOf(c)];
    expect(at(0, "Unit")).toBeNull();
    expect(at(1, "Unit")).toBeNull();
    expect(at(0, "Actual Unit")).toBe("km/L");
    expect(at(1, "Actual Unit")).toBe("L/hr");
    expect(at(0, "Actual")).toBe(12.69);
    expect(at(1, "Actual")).toBe(9.95);
  });

  it("labels Actual from the meter even when the band is quoted on the other basis", () => {
    // An hour band on a km odometer: the two unit columns disagree, and that
    // disagreement is the point.
    const s = sheetOf([row({ meterType: "KM", basis: "hr", unit: "L/hr", typ: 8, typDisplay: 8, comparable: false, bandReason: "basis-conflict", state: null, severity: 0, actualDisplay: 6.2 })]);
    const h = headerRow(s.aoa);
    const head = s.aoa[h] as string[];
    expect(s.aoa[h + 1][head.indexOf("Unit")]).toBe("L/hr");
    expect(s.aoa[h + 1][head.indexOf("Actual Unit")]).toBe("km/L");
  });

  it("reproduces the screenshot's top row cell for cell", () => {
    // HCC-06 as the screen renders it: 12.2 / 9.5 / 7.6 km/L, actual 5.6,
    // 6 intervals, "over heavy · 1.68×", 45/70/115 per km, billing Wet.
    const s = sheetOf([row()]);
    const h = headerRow(s.aoa);
    const cell = (name: string) => s.aoa[h + 1][(s.aoa[h] as string[]).indexOf(name)];
    expect(cell("Machine")).toBe("HCC-06");
    expect(cell("Reg No")).toBe("PH-6744");
    expect(cell("Category")).toBe("Asphalt Paver");
    expect(cell("Econ")).toBe(12.2);
    expect(cell("Standard")).toBe(9.5);
    expect(cell("Heavy")).toBe(7.6);
    expect(cell("Unit")).toBe("km/L");
    expect(cell("Actual")).toBe(5.6);
    expect(cell("Intervals")).toBe(6);
    expect(cell("Verdict")).toBe("over heavy");
    expect(cell("Severity (×)")).toBe(1.68);
    expect(cell("Rate Unit")).toBe("per km");
    expect(cell("Dry (LKR)")).toBe(45);
    expect(cell("Wet (LKR)")).toBe(70);
    expect(cell("Fully Wet (LKR)")).toBe(115);
    expect(cell("Bills On")).toBe("Wet");
  });

  it("states the rate unit, because one money column holds three different units", () => {
    const s = sheetOf([
      row({ assetId: "a1", chargeMode: "perkm", dryCents: 4_500 }),
      row({ assetId: "a2", code: "LB-22", chargeMode: "hourly", dryCents: 200_000 }),
      row({ assetId: "a3", code: "GE-62", chargeMode: "perday", dryCents: 1_000_000 }),
    ]);
    const h = headerRow(s.aoa);
    const idx = (s.aoa[h] as string[]).indexOf("Rate Unit");
    expect(s.aoa.slice(h + 1, h + 4).map((r) => r[idx])).toEqual(["per km", "per hour", "per day"]);
  });

  it("puts numbers in the numeric columns and leaves the missing ones empty", () => {
    const s = sheetOf([row({ wetCents: null, fullyWetCents: null, actualDisplay: null, state: null, severity: 0, intervals: 0 })]);
    const h = headerRow(s.aoa);
    const cell = (name: string) => s.aoa[h + 1][(s.aoa[h] as string[]).indexOf(name)];
    expect(cell("Wet (LKR)")).toBeNull();
    expect(cell("Fully Wet (LKR)")).toBeNull();
    expect(cell("Actual")).toBeNull();
    expect(cell("Severity (×)")).toBeNull();
    expect(cell("Intervals")).toBe(0);
  });

  it("withholds the severity when the screen shows no verdict badge", () => {
    const s = sheetOf([row({ state: null, severity: 2.02, intervals: 1, bandReason: "ok" })]);
    const h = headerRow(s.aoa);
    const cell = (name: string) => s.aoa[h + 1][(s.aoa[h] as string[]).indexOf(name)];
    expect(cell("Verdict")).toBe("1 interval — need 3");
    expect(cell("Severity (×)")).toBeNull();
  });

  it("totals only the interval count, never the rates", () => {
    const s = sheetOf([row({ intervals: 6 }), row({ assetId: "a2", code: "DT-83", intervals: 4 })]);
    const h = headerRow(s.aoa);
    const head = s.aoa[h] as string[];
    const total = s.aoa[s.aoa.length - 1];
    expect(total[0]).toBe("TOTAL");
    expect(total[1]).toBe("2 machines");
    expect(total[head.indexOf("Intervals")]).toBe(10);
    for (const c of ["Dry (LKR)", "Wet (LKR)", "Fully Wet (LKR)", "Standard", "Severity (×)"]) {
      expect(total[head.indexOf(c)], c).toBeNull();
    }
  });

  it("lines the header, the data and the total up with each other", () => {
    const s = sheetOf([row()]);
    const h = headerRow(s.aoa);
    const width = s.aoa[h].length;
    expect(s.aoa[h + 1]).toHaveLength(width);
    expect(s.aoa[s.aoa.length - 1]).toHaveLength(width);
    expect(s.widths).toHaveLength(width);
  });

  it("says at the top which rows it holds and who asked for them", () => {
    const s = sheetOf([row()], "20 of 770 machines — filter “Over standard”");
    expect(s.aoa[0][0]).toBe("Fuel & Rental Rates — 2026-08-25");
    expect(s.aoa[1][0]).toBe("20 of 770 machines — filter “Over standard”");
    expect(String(s.aoa[2][0])).toContain("Administrator");
    // The unit warning has to travel with the file, not stay on the screen.
    expect(String(s.aoa[2][0])).toContain("km/L for road vehicles");
    expect(String(s.aoa[2][0])).toContain("never sum or average");
  });

  it("still produces a readable sheet when the filter matches nothing", () => {
    const s = sheetOf([], "0 of 770 machines — filter “Not comparable”");
    expect(s.aoa[headerRow(s.aoa)]).toBeTruthy();
    expect(s.aoa.some((r) => r[0] === "No machine matches that filter.")).toBe(true);
    expect(s.aoa[s.aoa.length - 1][1]).toBe("0 machines");
  });

  it("names the file for the table and the Colombo day", () => {
    expect(ratesTableFilename(new Date("2026-08-24T19:30:00Z"))).toBe("fuel-rental-rates-table-2026-08-25.xlsx");
  });
});
