import { describe, it, expect } from "vitest";
import {
  buildRatesSheets, buildRatesWorkbook, machineRow, verdictOf, bandBasisSource,
  ratesWorkbookFilename, type RatesWorkbookInput, type Cell,
} from "../src/lib/reports/rates-workbook";
import type { RateBandRow } from "../src/lib/consumption/rates-overview";
import type { PortableOverview } from "../src/lib/consumption/portable-overview";
import { PORTABLE_CLASSES } from "../src/lib/consumption/portable-rate-card";

// A machine as getRatesOverview would hand it over. Overridden per test.
function row(over: Partial<RateBandRow> = {}): RateBandRow {
  return {
    assetId: "a1", code: "JCB-01", regNo: "ABC-1234", typeLabel: "Backhoe",
    categoryName: "Backhoe Loader", projectName: "Awissawella", status: "ACTIVE",
    meterType: "HOURS", hasRateCard: true,
    econ: 4.32, typ: 6, heavy: 8.1, basis: "hr",
    econDisplay: 4.32, typDisplay: 6, heavyDisplay: 8.1, unit: "L/hr",
    comparable: true, bandReason: "ok",
    actualDisplay: 7.5, intervals: 5, state: "HEAVY", severity: 1.25,
    totalLitres: 1234.56, emptyReason: null,
    chargeMode: "hourly", dryCents: 200_000, wetCents: 415_000, fullyWetCents: null,
    defaultBasis: "w", equipType: "FLEET",
    ...over,
  };
}

const emptyPortable: PortableOverview = {
  classes: PORTABLE_CLASSES.map((k) => ({ ...k, fleetCount: 0, codes: [] })),
  machines: [],
  counts: { total: 0, onCard: 0, dryOnly: 0, wetOnly: 0, offCard: 0, unpriced: 0, fillable: 0, billsNothing: 0 },
};

function input(over: Partial<RatesWorkbookInput> = {}): RatesWorkbookInput {
  return {
    rows: [row()],
    counts: {
      total: 1, withBand: 1, withHeavy: 1, noRateCard: 0, noBand: 0, basisConflict: 0,
      measured: 1, verdicts: 1, over: 0, heavy: 1, normal: 0, belowEcon: 0,
    },
    litresMeasured: 800, litresTotal: 1000,
    portable: emptyPortable,
    rawBasis: new Map([["a1", "hr"]]),
    generatedAt: new Date("2026-08-25T04:00:00Z"),
    exportedBy: "Administrator",
    ...over,
  };
}

const sheet = (i: RatesWorkbookInput, name: string) => buildRatesSheets(i).find((s) => s.name === name)!;

/**
 * Where a sheet's header row is, found by its first cell rather than counted.
 * Adding a line of prose above a table used to shift every index in this file.
 */
function headerRow(s: { aoa: Cell[][] }, firstHeader: string): number {
  const idx = s.aoa.findIndex((r) => r[0] === firstHeader);
  if (idx < 0) throw new Error(`no header row starting "${firstHeader}"`);
  return idx;
}

describe("the workbook's shape", () => {
  it("has all seven sheets, in order", () => {
    expect(buildRatesSheets(input()).map((s) => s.name)).toEqual([
      "Cover", "Summary", "Machines", "Above Standard", "Portable Card", "Portable Fleet", "Legend",
    ]);
  });

  it("lines every data row up with its header, on every sheet", () => {
    // The classic silent failure: a header added without its cell, so every
    // column after it is shifted and reads under the wrong name.
    const firstHeaderCell: Record<string, string> = {
      Machines: "Machine", "Above Standard": "Rank", "Portable Card": "Category", "Portable Fleet": "Machine",
    };
    const i = input({
      portable: {
        ...emptyPortable,
        machines: [{ assetId: "p1", code: "GE-01", typeLabel: null, categoryName: "Generator",
          projectName: null, status: "ACTIVE", wetCents: null, dryCents: 600_000, defaultBasis: "d",
          cardCategory: "Generator", match: "dry-only", matchedClassId: "generator/20-25kva",
          cardWetCents: 1_200_000, cardDryCents: 600_000 }],
        counts: { ...emptyPortable.counts, total: 1, dryOnly: 1, fillable: 1 },
      },
    });
    for (const [name, first] of Object.entries(firstHeaderCell)) {
      const s = sheet(i, name);
      const hIdx = headerRow(s, first);
      const width = s.aoa[hIdx].length;
      const dataRow = s.aoa[hIdx + 1];
      expect(dataRow.length, `${name} data row`).toBe(width);
      expect(s.widths.length, `${name} widths`).toBe(width);
      // And the TOTAL row, where the fixed indexes live.
      const last = s.aoa[s.aoa.length - 1];
      if (last[0] === "TOTAL") expect(last.length, `${name} TOTAL row`).toBe(width);
    }
  });

  it("puts each total under the column it belongs to, by name not by luck", () => {
    const i = input({ rows: [row({ intervals: 4, totalLitres: 10 })] });
    const s = sheet(i, "Machines");
    const head = s.aoa[2] as string[];
    const total = s.aoa[s.aoa.length - 1];
    expect(head[10]).toBe("Intervals");
    expect(head[33]).toBe("Total Litres");
    expect(total[10]).toBe(4);
    expect(total[33]).toBe(10);
    const pf = sheet(i, "Portable Fleet");
    expect((pf.aoa[headerRow(pf, "Machine")] as string[])[14]).toBe("Bills Nothing Today");
    const pc = sheet(i, "Portable Card");
    expect((pc.aoa[headerRow(pc, "Category")] as string[])[5]).toBe("In Fleet");
  });

  it("gives every sheet a width for every column it declares", () => {
    for (const s of buildRatesSheets(input())) {
      const widest = Math.max(...s.aoa.map((r) => r.length));
      expect(s.widths.length, `${s.name} declares ${s.widths.length} widths for ${widest} columns`)
        .toBeGreaterThanOrEqual(widest);
    }
  });

  it("keeps every tab name inside Excel's 31-character limit and free of forbidden characters", () => {
    for (const s of buildRatesSheets(input())) {
      expect(s.name.length, s.name).toBeLessThanOrEqual(31);
      expect(s.name).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it("actually writes a workbook xlsx can read back", () => {
    const wb = buildRatesWorkbook(input());
    expect(wb.SheetNames).toHaveLength(7);
    expect(wb.Sheets["Machines"]["!cols"]).toBeTruthy();
    expect(wb.Sheets["Machines"]["!merges"]).toHaveLength(1);
  });

  it("stamps the filename with the Colombo day, not the host's", () => {
    // 19:30 UTC on the 24th is already the 25th in Colombo (+5:30).
    expect(ratesWorkbookFilename(new Date("2026-08-24T19:30:00Z"))).toBe("fuel-rental-rates-2026-08-25.xlsx");
  });
});

describe("cells Excel has to be able to add up", () => {
  const headerIdx = (name: string) => {
    const s = sheet(input(), "Machines");
    return (s.aoa[2] as string[]).indexOf(name);
  };

  it("writes money as a number of rupees, keeping the cents", () => {
    const r = machineRow(row({ dryCents: 1_250_050, wetCents: 415_000 }), new Map());
    expect(r[headerIdx("Dry (LKR)")]).toBe(12500.5);
    expect(r[headerIdx("Wet (LKR)")]).toBe(4150);
  });

  it("rounds the cents before dividing, so a total cannot drift from its column", () => {
    // Math.round(cents/100) would give 12500 here and lose 50 cents a row.
    const r = machineRow(row({ dryCents: 1_250_050 }), new Map());
    expect(r[headerIdx("Dry (LKR)")]).not.toBe(12500);
  });

  it("leaves a missing figure genuinely empty — not 0, not an em dash, not a blank string", () => {
    const r = machineRow(row({ wetCents: null, fullyWetCents: null, actualDisplay: null, severity: 0 }), new Map());
    for (const col of ["Wet (LKR)", "Fully Wet (LKR)", "Actual", "Severity (×)"]) {
      const v = r[headerIdx(col)];
      expect(v, col).toBeNull();
    }
  });

  it("writes zero intervals as the number 0, not as a dash", () => {
    // The screen renders `intervals || "—"`, which would make the column text.
    const r = machineRow(row({ intervals: 0 }), new Map());
    expect(r[headerIdx("Intervals")]).toBe(0);
  });

  it("never puts a unit or a separator inside a numeric cell", () => {
    const s = sheet(input(), "Machines");
    const numeric = ["Econ", "Standard", "Heavy", "Actual", "Intervals", "Severity (×)", "Dry (LKR)", "Wet (LKR)", "Total Litres"];
    const head = s.aoa[2] as string[];
    for (const dataRow of s.aoa.slice(3, 4)) {
      for (const col of numeric) {
        const v = dataRow[head.indexOf(col)];
        expect(typeof v === "number" || v === null, `${col} was ${JSON.stringify(v)}`).toBe(true);
      }
    }
  });

  it("rounds floats so a cell does not read 4.807692307692308", () => {
    const r = machineRow(row({ actualDisplay: 4.807692307692308, totalLitres: 1234.5600000000002, econ: 0.20833333 }), new Map());
    expect(r[headerIdx("Actual")]).toBe(4.81);
    expect(r[headerIdx("Total Litres")]).toBe(1234.56);
    expect(r[headerIdx("Econ (storage)")]).toBe(0.208333);
  });

  it("keeps enough places on the smallest storage bands to stay meaningful", () => {
    // An L/km band runs down to 0.05. Four decimals would leave 0.0666667 as
    // 0.0667 — three significant figures on a number a rate is derived from.
    const r = machineRow(row({ econ: 0.0666667, typ: 0.05, heavy: 0.0625 }), new Map());
    expect(r[headerIdx("Econ (storage)")]).toBe(0.066667);
    expect(r[headerIdx("Standard (storage)")]).toBe(0.05);
    expect(r[headerIdx("Heavy (storage)")]).toBe(0.0625);
  });

  it("withholds the severity from a machine that has no verdict", () => {
    // consumption-series sets severity off ONE interval; a verdict needs three.
    // Publishing it puts never-measured machines at the top of a severity sort
    // while the cell beside them reads "1 interval — need 3".
    const unmeasured = row({ state: null, severity: 2.02, intervals: 1, bandReason: "ok" });
    const r = machineRow(unmeasured, new Map());
    expect(r[headerIdx("Severity (×)")]).toBeNull();
    expect(r[headerIdx("Verdict")]).toBe("1 interval — need 3");
    // A machine that does have a verdict keeps its number.
    expect(machineRow(row({ state: "HEAVY", severity: 1.25 }), new Map())[headerIdx("Severity (×)")]).toBe(1.25);
  });
});

describe("the unit trap", () => {
  it("labels the band's unit and the meter's unit separately", () => {
    const s = sheet(input(), "Machines");
    const head = s.aoa[2] as string[];
    expect(head).toContain("Band Unit");
    expect(head).toContain("Actual Unit");
  });

  it("shows the two units disagreeing on a machine whose band is per hour and meter per km", () => {
    // This is the ~95-machine meter-type dispute. The screen hides the conflict
    // by withholding the verdict; the sheet has to show it.
    const conflict = row({
      meterType: "KM", basis: "hr", unit: "L/hr", comparable: false,
      bandReason: "basis-conflict", state: null, severity: 0, actualDisplay: 8.2,
    });
    const r = machineRow(conflict, new Map());
    const head = sheet(input(), "Machines").aoa[2] as string[];
    expect(r[head.indexOf("Band Unit")]).toBe("L/hr");
    expect(r[head.indexOf("Actual Unit")]).toBe("km/L");
    expect(r[head.indexOf("Comparable")]).toBe("no");
    // And the measured burn is still carried — only the comparison is invalid.
    expect(r[head.indexOf("Actual")]).toBe(8.2);
  });

  it("prints a band unit for a trailer stored at zero, with the band cells blank", () => {
    // fuelConsTyp === 0 means "no consumption", not "unknown consumption".
    const trailer = row({ typ: 0, econ: 0, heavy: 0, typDisplay: null, econDisplay: null, heavyDisplay: null });
    const r = machineRow(trailer, new Map());
    const head = sheet(input(), "Machines").aoa[2] as string[];
    expect(r[head.indexOf("Band Unit")]).toBe("L/hr");
    expect(r[head.indexOf("Standard")]).toBeNull();
  });

  it("carries the storage figures beside the display ones", () => {
    const road = row({ meterType: "KM", basis: "km", unit: "km/L", econ: 0.2083, typ: 0.25, heavy: 0.3125,
      econDisplay: 4.8, typDisplay: 4, heavyDisplay: 3.2 });
    const r = machineRow(road, new Map());
    const head = sheet(input(), "Machines").aoa[2] as string[];
    expect(r[head.indexOf("Storage Unit")]).toBe("L/km");
    expect(r[head.indexOf("Standard (storage)")]).toBe(0.25);
    expect(r[head.indexOf("Standard")]).toBe(4);
  });
});

describe("the verdict cell", () => {
  it("reads exactly as the screen does", () => {
    expect(verdictOf(row({ state: "OVER" }))).toBe("over heavy");
    expect(verdictOf(row({ state: "HEAVY" }))).toBe("above standard");
    expect(verdictOf(row({ state: "NORMAL" }))).toBe("within band");
    expect(verdictOf(row({ state: "BELOW_ECON" }))).toBe("below econ");
  });

  it("falls back to the reason, then to the interval count", () => {
    expect(verdictOf(row({ state: null, bandReason: "no-rate-card" }))).toBe("no rate card");
    expect(verdictOf(row({ state: null, bandReason: "basis-conflict" }))).toBe("not comparable — hour band on a km meter");
    expect(verdictOf(row({ state: null, bandReason: "ok", intervals: 2 }))).toBe("2 interval — need 3");
    expect(verdictOf(row({ state: null, bandReason: "ok", intervals: 0 }))).toBe("not measured");
  });

  it("does not append the severity — that has its own numeric column", () => {
    expect(verdictOf(row({ state: "OVER", severity: 1.62 }))).toBe("over heavy");
  });
});

describe("stated versus inferred band units", () => {
  it("says stored when the rate card names the basis", () => {
    expect(bandBasisSource(row(), new Map([["a1", "hr"]]))).toBe("stored");
  });

  it("says inferred when resolveBand guessed it from the magnitude", () => {
    expect(bandBasisSource(row({ basis: "hr" }), new Map([["a1", null]]))).toBe("inferred");
  });

  it("says nothing at all when there is no rate card", () => {
    expect(bandBasisSource(row({ hasRateCard: false }), new Map())).toBeNull();
  });

  it("says nothing when a card exists but no basis could be settled", () => {
    expect(bandBasisSource(row({ basis: null }), new Map([["a1", null]]))).toBeNull();
  });
});

describe("totals", () => {
  const totalRow = (name: string, i = input()): Cell[] => {
    const s = sheet(i, name);
    return s.aoa[s.aoa.length - 1];
  };

  it("totals only what can be added — never the rate or band columns", () => {
    const i = input({ rows: [row(), row({ assetId: "a2", code: "JCB-02", intervals: 3, totalLitres: 100 })] });
    const t = totalRow("Machines", i);
    const head = sheet(i, "Machines").aoa[2] as string[];
    expect(t[0]).toBe("TOTAL");
    expect(t[head.indexOf("Intervals")]).toBe(8);
    expect(t[head.indexOf("Total Litres")]).toBe(1334.56);
    // Rs/hr, Rs/km and Rs/day share one column; their sum means nothing.
    expect(t[head.indexOf("Dry (LKR)")]).toBeNull();
    expect(t[head.indexOf("Wet (LKR)")]).toBeNull();
    expect(t[head.indexOf("Standard")]).toBeNull();
    expect(t[head.indexOf("Severity (×)")]).toBeNull();
  });

  it("pads a total row with nulls, never with empty strings", () => {
    for (const cell of totalRow("Machines")) {
      expect(cell === null || typeof cell === "string" || typeof cell === "number").toBe(true);
      expect(cell).not.toBe("");
    }
  });

  it("totals the fleet count on the portable card but not the prices", () => {
    const t = totalRow("Portable Card");
    expect(t[0]).toBe("TOTAL");
    expect(t[1]).toBe("36 classes");
    expect(t[5]).toBe(0);
    expect(t[2]).toBeNull();
    expect(t[3]).toBeNull();
  });
});

describe("what the screen hides and the sheet must not", () => {
  it("lists every machine above standard, not the screen's first twelve", () => {
    const many = Array.from({ length: 20 }, (_, k) =>
      row({ assetId: `a${k}`, code: `M-${k}`, state: "OVER", severity: 2 - k / 100 }));
    const s = sheet(input({ rows: many }), "Above Standard");
    // title + note + blank + header = 4 rows before the data
    expect(s.aoa.length - 4).toBe(20);
    expect(s.aoa[1][0]).toContain("all 20");
  });

  it("ranks the above-standard sheet worst first, so Rank agrees with Severity", () => {
    // getRatesOverview orders by state class first, so an over-heavy machine at
    // 1.2x precedes an above-standard one at 1.9x. A Rank column printed beside
    // a Severity column has to disagree with neither.
    const rows = [
      row({ assetId: "a1", code: "OVER-LOW", state: "OVER", severity: 1.2 }),
      row({ assetId: "a2", code: "HEAVY-HIGH", state: "HEAVY", severity: 1.9 }),
      row({ assetId: "a3", code: "OVER-MID", state: "OVER", severity: 1.5 }),
    ];
    const s = sheet(input({ rows }), "Above Standard");
    const h = headerRow(s, "Rank");
    const data = s.aoa.slice(h + 1);
    expect(data.map((r) => r[1])).toEqual(["HEAVY-HIGH", "OVER-MID", "OVER-LOW"]);
    expect(data.map((r) => r[0])).toEqual([1, 2, 3]);
    const sev = h === -1 ? [] : data.map((r) => r[s.aoa[h].indexOf("Severity (×)")] as number);
    expect(sev).toEqual([...sev].sort((a, b) => b - a));
  });

  it("still emits a header and a plain sentence when nothing is above standard", () => {
    const s = sheet(input({ rows: [row({ state: "NORMAL" })] }), "Above Standard");
    expect(s.aoa[s.aoa.length - 1][0]).toBe("No machine is burning above its standard band.");
  });

  it("repeats the category on every portable card row instead of blanking it for grouping", () => {
    const s = sheet(input(), "Portable Card");
    const h = headerRow(s, "Category");
    const cats = s.aoa.slice(h + 1, h + 8).map((r) => r[0]);
    expect(cats.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(cats.filter((c) => c === "Generator").length).toBeGreaterThan(1);
  });

  it("brings the machine codes out of the hover tooltip into a real column", () => {
    const withFleet: PortableOverview = {
      ...emptyPortable,
      classes: emptyPortable.classes.map((k) =>
        k.id === "generator/10kva" ? { ...k, fleetCount: 2, codes: ["GE-05", "GE-08"] } : k),
    };
    const s = sheet(input({ portable: withFleet }), "Portable Card");
    const head = s.aoa[headerRow(s, "Category")] as string[];
    const hit = s.aoa.find((r) => r[head.indexOf("Class ID")] === "generator/10kva")!;
    expect(hit[head.indexOf("Machine Codes")]).toBe("GE-05, GE-08");
    expect(hit[head.indexOf("In Fleet")]).toBe(2);
  });

  it("flags a portable machine that would bill nothing today", () => {
    const portable: PortableOverview = {
      ...emptyPortable,
      machines: [
        // Dry-priced but defaults to wet, so a bill falls to an empty tier.
        { assetId: "p1", code: "AC-25", typeLabel: "Compreshor", categoryName: "Compressor",
          projectName: "Awissawella", status: "ACTIVE", wetCents: null, dryCents: 1_100_000,
          defaultBasis: null, cardCategory: "Air Compressor", match: "dry-only",
          matchedClassId: "compressor/185cfm", cardWetCents: 1_600_000, cardDryCents: 1_100_000 },
        // Same rates but explicitly dry-hired, so it bills fine.
        { assetId: "p2", code: "AC-27", typeLabel: "Compressor", categoryName: "Compressor",
          projectName: "Badalgama", status: "ACTIVE", wetCents: null, dryCents: 1_100_000,
          defaultBasis: "d", cardCategory: "Air Compressor", match: "dry-only",
          matchedClassId: "compressor/185cfm", cardWetCents: 1_600_000, cardDryCents: 1_100_000 },
      ],
      counts: { ...emptyPortable.counts, total: 2, dryOnly: 2, fillable: 2, billsNothing: 1 },
    };
    const s = sheet(input({ portable }), "Portable Fleet");
    const head = s.aoa[3] as string[];
    const col = head.indexOf("Bills Nothing Today");
    expect(s.aoa[4][col]).toBe("yes");
    expect(s.aoa[5][col]).toBe("no");
    // And what the card would charge, which the screen only implies.
    expect(s.aoa[4][head.indexOf("Card Wet (LKR/day)")]).toBe(16000);
  });

  it("names a fully-wet portable default instead of calling it unset", () => {
    // Portable plant has no fully-wet tier, so pickRateCents bills it wet. The
    // bill is the same; describing the setting as "unset" would not be.
    const portable: PortableOverview = {
      ...emptyPortable,
      machines: [{ assetId: "p1", code: "GE-05", typeLabel: null, categoryName: "Generator",
        projectName: null, status: "ACTIVE", wetCents: 700_000, dryCents: 350_000, defaultBasis: "fw",
        cardCategory: "Generator", match: "exact", matchedClassId: "generator/10kva",
        cardWetCents: 700_000, cardDryCents: 350_000 }],
      counts: { ...emptyPortable.counts, total: 1, onCard: 1 },
    };
    const s = sheet(input({ portable }), "Portable Fleet");
    const h = headerRow(s, "Machine");
    expect(s.aoa[h + 1][h === -1 ? 0 : (s.aoa[h] as string[]).indexOf("Bills On")])
      .toBe("Fully wet → wet (portable has no fully-wet tier)");
    // It bills the wet rate, which is set, so it is not billing nothing.
    expect(s.aoa[h + 1][(s.aoa[h] as string[]).indexOf("Bills Nothing Today")]).toBe("no");
  });

  it("tells the reader that portable machines are in the Machines sheet too", () => {
    // They are: getRatesOverview filters nothing. Saying otherwise invites a
    // reader to average Rs/day into a column of Rs/hr.
    const s = sheet(input(), "Cover");
    const text = s.aoa.map((r) => r.join(" ")).join("\n");
    expect(text).toContain("in the Machines sheet");
    expect(text).not.toContain("rather than in the machine table");
  });

  it("keeps a long type label whole rather than truncating it for column width", () => {
    const long = "From site fuel sheet — set type and capacity by hand";
    const portable: PortableOverview = {
      ...emptyPortable,
      machines: [{ assetId: "p1", code: "AC-42", typeLabel: long, categoryName: "Compressor",
        projectName: null, status: "ACTIVE", wetCents: null, dryCents: 1_100_000, defaultBasis: "d",
        cardCategory: "Air Compressor", match: "dry-only", matchedClassId: "compressor/185cfm",
        cardWetCents: 1_600_000, cardDryCents: 1_100_000 }],
      counts: { ...emptyPortable.counts, total: 1, dryOnly: 1 },
    };
    const s = sheet(input({ portable }), "Portable Fleet");
    expect(s.aoa[4][2]).toBe(long);
    expect(s.aoa[4][3]).toBe("unassigned");
  });
});

describe("the summary sheet", () => {
  it("writes the percentage as a number, not as a string with a percent sign", () => {
    const s = sheet(input({ litresMeasured: 123, litresTotal: 1000 }), "Summary");
    const hit = s.aoa.find((r) => r[0] === "Fuel checked (%)")!;
    expect(hit[1]).toBe(12.3);
  });

  it("does not divide by zero when no fuel has been issued", () => {
    const s = sheet(input({ litresMeasured: 0, litresTotal: 0 }), "Summary");
    expect(s.aoa.find((r) => r[0] === "Fuel checked (%)")![1]).toBe(0);
  });

  it("keeps 'never measured' and 'no verdict' as separate lines", () => {
    // Conflating them is exactly what the Gaps panel exists to prevent: one
    // counts zero intervals, the other also catches 1-2 intervals and bands
    // that cannot be compared.
    const i = input({
      counts: { ...input().counts, total: 100, measured: 40, verdicts: 25 },
    });
    const s = sheet(i, "Summary");
    expect(s.aoa.find((r) => r[0] === "Never measured (0 intervals)")![1]).toBe(60);
    expect(s.aoa.find((r) => String(r[0]).startsWith("No verdict"))![1]).toBe(75);
  });

  it("counts the pricing tiers off the rows it was given", () => {
    const i = input({
      rows: [
        row({ assetId: "a1", wetCents: 415_000, dryCents: 200_000, fullyWetCents: null, defaultBasis: "w" }),
        row({ assetId: "a2", wetCents: null, dryCents: null, fullyWetCents: null, defaultBasis: null }),
        row({ assetId: "a3", wetCents: 300_000, dryCents: null, fullyWetCents: 500_000, defaultBasis: "d" }),
      ],
      counts: { ...input().counts, total: 3 },
    });
    const s = sheet(i, "Summary");
    const val = (m: string) => s.aoa.find((r) => r[0] === m)![1];
    expect(val("Priced wet")).toBe(2);
    expect(val("No wet rate")).toBe(1);
    expect(val("Priced dry")).toBe(1);
    expect(val("Carrying a fully-wet rate")).toBe(1);
    expect(val("Bills wet by default")).toBe(1);
    expect(val("Bills dry by default")).toBe(1);
    expect(val("Default basis unset (falls to wet)")).toBe(1);
    expect(val("No rate at all (all three tiers empty)")).toBe(1);
  });
});

describe("the cover", () => {
  it("names who exported it and when, in Colombo time", () => {
    const s = sheet(input(), "Cover");
    expect(s.aoa.find((r) => r[0] === "Exported by")![1]).toBe("Administrator");
    expect(String(s.aoa.find((r) => r[0] === "Generated")![1])).toMatch(/2026/);
  });

  it("says plainly that the file is not scoped to a site", () => {
    const s = sheet(input(), "Cover");
    expect(String(s.aoa.find((r) => r[0] === "Scope")![1])).toContain("Whole fleet");
  });

  it("carries the live caveat numbers, not placeholders", () => {
    const i = input({ counts: { ...input().counts, total: 100, verdicts: 25, basisConflict: 96 } });
    const s = sheet(i, "Cover");
    const text = s.aoa.map((r) => r.join(" ")).join("\n");
    expect(text).toContain("75 machines have no verdict");
    expect(text).toContain("96 machines carry an hour-based band");
  });
});
