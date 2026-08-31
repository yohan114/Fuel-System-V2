import type { LongSpec } from "./readers/long";

// The per-site registry: everything that genuinely differs between one site's
// fuel workbook and another's, and nothing that doesn't.
//
// Before this file there were eleven bespoke importers under scripts/, and they
// had drifted apart in ways that cost money — one deletes before inserting and
// one appends; one dedupes on (day, code, litres), which destroys the same-day
// repeat fills that are real and common, and one dedupes on a (day, asset)
// count, which preserves them. Six more loads sitting in the database were done
// by scripts that were never checked in at all, which is how the alias knowledge
// they carried (MS-18 -> MG-18, RQ 3187 -> RG-3187) was lost.
//
// So: one core, one reader per genuinely different sheet shape, and the site
// differences declared here where they can be reviewed.

export type SiteProfile = {
  /** Project code — must exist in Project.code, and must have a BulkTank. */
  project: string;
  /** Free-text provenance, stamped on FuelIssue.source. Name the DOCUMENT. */
  source: string;
  /** The workbook. Absolute, because these live outside the repo. */
  file: string;
  spec: LongSpec;

  /** Labels the fleet matcher cannot reach on its own, with the evidence for
   *  each. Nothing goes in here on a hunch — an unresolved label stops the run. */
  aliases?: Record<string, string>;

  /** Labels that ARE machines but cannot be identified, mapped to the reason.
   *  Their rows are left out of the import and printed on every run with their
   *  litres, so the gap stays visible instead of quietly stopping the site.
   *  This is the honest home for a code that has no defensible match — guessing
   *  one puts a machine's fuel on another's permanent record where nothing
   *  downstream will ever reveal it. */
  holdBack?: Record<string, string>;

  /** Readings the source itself says are unreliable, keyed "yyyy-mm-dd|LABEL".
   *  The fuel on these lines is still imported; only the reading is dropped. */
  untrustedMeters?: Set<string>;

  /** Machines whose STORED history is the wrong side of the argument: the sheet
   *  resumes below the last reading on file, but the sheet's own chain is
   *  internally coherent and the stored figure is the outlier. Keyed by the
   *  label as written, mapped to the evidence. Lifts the opening check for that
   *  machine only — the sheet's rows are still checked against each other. */
  trustSheetMeter?: Record<string, string>;

  /** Everything after this day is ignored. For a workbook that runs past the
   *  period being loaded. */
  dateCeiling?: string;

  notes?: string;
};

const D = "D:/Projects sites";

export const SITES: Record<string, SiteProfile> = {
  // ── Mannarama ─────────────────────────────────────────────────────────────
  MANN: {
    project: "MANN",
    source: "LOT-05 daily fuel issuing sheet (Aug 2026)",
    file: `${D}/LOT-05/Daily_Fuel_Issuing_Sheet_LOT_05.xlsx`,
    notes:
      "Daily Fuel Log is the combined view; the 18 dated tabs restate the same " +
      "rows and are not read. Meters are written N/W when the unit is broken. " +
      "The tank has no receipts recorded at all, so its balance goes negative " +
      "on the issue side alone — that is a receipts gap, not an import fault, " +
      "and is why stock is left alone.",
    spec: {
      kind: "long",
      sheet: "Daily Fuel Log",
      headerMatch: /^Date$/i,
      dateFormat: "dd/mm/yyyy",
      cols: { date: 0, label: 1, category: 2, driver: 5, fills: [{ litres: 3, meter: 4 }] },
    },
    untrustedMeters: new Set([
      // Copy-paste down the column. On 15 Aug the sheet gives ZA-6099 (a JCB)
      // the reading 3013.1 — the identical figure entered three rows above for
      // MG-10, a motor grader, whose own series runs 3001 -> 3013.1 -> 3030.3
      // and owns it. ZA-6099 reads 3945.1 on 14 Aug and 3955.6 on 20 Aug, so
      // its true 15 Aug figure is somewhere between and was never written down.
      // The 30 L is real and is imported; only the reading is dropped.
      "2026-08-15|ZA-6099",
    ]),
  },

  // ── Mutur Plant ───────────────────────────────────────────────────────────
  MUTUR: {
    project: "MUTUR",
    // EN DASH in "Jul–Aug", matching the 50 rows this site already has. An ASCII
    // hyphen here reads as a second, near-identical source and splits the site's
    // history in two everywhere it is grouped by source.
    source: "Muttur Plant diesel log (Jul–Aug 2026)",
    file: `${D}/Muthu ( MR Thilanka)/Muttur_Plant_Diesel_Log_Data.xlsx`,
    notes:
      "The Type column carries both Issue and Received rows in one table — the " +
      "two Received lines are 1,200 L of deliveries and would be billed as " +
      "refuels without the filter below. This log is also the authority for the " +
      "13-14 Aug LD-07 rows that the Wadakada workbook transcribes as well: " +
      "Wadakada's sheet is titled 'CEP/3 WADAKADA & MUTTUR PLANT' and carries " +
      "part of this site's register. Import them here, not there.",
    spec: {
      kind: "long",
      sheet: "All Data (Combined)",
      headerMatch: /^Date$/i,
      dateFormat: "yyyy-mm-dd",
      rowFilter: (r) => String(r[5] ?? "").trim().toLowerCase() === "issue",
      cols: { date: 0, label: 1, driver: 4, note: 7, fills: [{ litres: 2, meter: 3 }] },
    },
  },

  // ── EP I-Road Lot-03 ──────────────────────────────────────────────────────
  "IRD-03": {
    project: "IRD-03",
    source: "EP I-Road Lot-03 daily diesel issue report (Aug 2026)",
    file: `${D}/LOT 3 Sameera/Daily_Diesel_Issue_Report.xlsx`,
    notes:
      "Header sits on row 4 under two title rows and a blank — located by the " +
      "word Date, not by offset. Note the column order differs from every other " +
      "site here: METER comes before LITRES. The month is incomplete (nine " +
      "working days were never transcribed), so this load does not make August " +
      "billable for the site.",
    spec: {
      kind: "long",
      sheet: "All Daily Logs",
      headerMatch: /^Date$/i,
      dateFormat: "yyyy-mm-dd",
      cols: { date: 0, label: 1, category: 2, driver: 5, note: 6, fills: [{ litres: 4, meter: 3 }] },
      // "Form oil" is form-release oil issued to a subcontractor, not fuel and
      // not a machine — the row has "Sub Damith" sitting in the Description
      // column, which is where the vehicle description belongs.
      skipLabels: ["Form oil", "TOTAL ISSUED FUEL (LITERS)"],
    },
    aliases: {
      // Z read as 2 and B as 8, both shape confusions rather than digit slips,
      // so the one-digit-out matcher cannot reach it. Settled by the meter, not
      // by the plate: the sheet reads 28-1546 at 8172 hours on 11 Aug, and the
      // system already holds 8172 for LB-17 on 10 Aug from the earlier load,
      // with 8167 / 8175.2 / 8196.1 either side. Same machine, same JCB.
      "28-1546": "ZB-1546",   // -> LB-17
      // The workbook settles this one itself: it writes ZA-7034 "J.C.B" on both
      // 15 and 16 Aug for the same machine and driver (Sahan). ZB-7034 on 13 Aug
      // is that machine with one letter slipped.
      "ZB-7034": "ZA-7034",   // -> LB-10
    },
    untrustedMeters: new Set([
      // HEX-05's only reading anywhere is a service entry of 9270 hours from
      // Nov 2024. The workbook writes "-" on nine of its ten HEX-05 lines and
      // 5203.4 on the tenth. One isolated figure, 4,000 hours below the only
      // other one on record and with nothing either side to corroborate it,
      // establishes nothing — the machine has probably had a meter fitted since.
      // The 20 L is imported; the reading is not.
      "2026-08-13|HEX-05",
    ]),
    trustSheetMeter: {
      "VR-70":
        "The stored 690 (5 Aug) and 698.2 (7 Aug) are a 4 read as a 9, twice in " +
        "the same hand: 640 and 648.2. The undisputed 641.5 on 6 Aug sits " +
        "between them and makes 690 -> 641.5 -> 698.2 impossible as written. " +
        "The sheet resumes at 658.7 and runs 663.7, 666.7, 669.5 — 2.5 to 3 " +
        "hours a day, which is exactly the rate from 641.5 on 6 Aug. The new " +
        "chain is the coherent one.",
    },
    holdBack: {
      "LP-9041":
        "One row, 20 L, 16 Aug, described only as 'Bed'. No meter, no fleet " +
        "match, and its driver (Sangeeth) appears on no other line in the " +
        "workbook. The site's other beds are LK-5041, LL-1282, LM-6653 and " +
        "LC-0434 and none is within a plausible slip of this plate. Ask the site.",
    },
  },

  // ── Inginimitiya ──────────────────────────────────────────────────────────
  ING: {
    project: "ING",
    source: "Inginimitiya daily fuel issuing sheets (Aug 2026)",
    file: `${D}/Inginimitiya/Inginimitiya Diesel Details.xlsx`,
    notes:
      "The dated tabs are read, NOT the 'August 2026' monthly grid, and the two " +
      "were checked against each other first: they agree litre-for-litre on all " +
      "twelve days 11-22 Aug. The tabs are the better view — they carry meter " +
      "readings and drivers, which the grid has no columns for, and they keep " +
      "SL-10's two separate 10 L fills on 21 Aug that the grid's single cell " +
      "collapses into one 20 L entry. The grid also repeats its 1..31 day header " +
      "partway down as the petrol section begins, which is worth 496 phantom " +
      "litres to a reader that walks to the end of the sheet.\n" +
      "'Board (Form work)' is shuttering, not a machine — 1 L of it, skipped.",
    spec: {
      kind: "long",
      sheets: { match: /^\d{2}-\d{2}-\d{4}$/, day: (n) => `${n.slice(6, 10)}-${n.slice(3, 5)}-${n.slice(0, 2)}` },
      headerMatch: /Vehicle\s*Reg/i,
      dateFormat: "dd-mm-yyyy",
      skipLabels: ["Total Issued Qty (Ltrs)"],
      cols: { label: 1, category: 2, driver: 5, fills: [{ litres: 3, meter: 4 }] },
    },
    holdBack: {
      "Board (Form work)":
        "1 L, 21 Aug, for shuttering. Real diesel, but not issued to a machine, " +
        "so there is nothing to charge it to. Same case as Lot-02's 'Lab' row.",
    },
    untrustedMeters: new Set([
      // ZA-2964 is LB-03, and the sheet reads it at 7.2, 18.1 and 24 hours —
      // internally consistent, climbing at a believable rate, and starting from
      // near zero. That is a NEW hour meter, and it would not be this machine's
      // first: its service history runs 675 -> 1020 -> 1250 -> 180 -> 550, which
      // is two replacements already.
      //
      // The three litre figures are real and are imported. The readings are not
      // stored, because MeterReading has no way to record that a meter was
      // changed — writing 24 as the machine's latest reading would put it below
      // its last service at 550 and make every hours-since-service figure
      // downstream nonsense. Once the replacement is recorded, load them.
      "2026-08-19|ZA-2964",
      "2026-08-21|ZA-2964",
      "2026-08-22|ZA-2964",
    ]),
  },

  // ── ICDP Batti Lot-02 ─────────────────────────────────────────────────────
  "BATTI-02": {
    project: "BATTI-02",
    source: "Lot-02 fuel issuing sheet (Aug 2026)",
    file: `${D}/Lot 2/Fuel_Issuing_Data_Lot2.xlsx`,
    notes:
      "'Master Detailed Sheet' is read rather than 'Fuel Issuing Data (All)'. " +
      "This site's form lets one line hold TWO refuels — a 1st and a 2nd Fuel " +
      "Qty, each with its own meter — and the All sheet keeps only the summed " +
      "Total Qty and a 'a / b' meter string. Summing them would throw half the " +
      "readings away and hide that the machine came back to the pump.\n" +
      "1-3 Aug is already over-charged by 95 L in the database from an earlier " +
      "load. That is pre-existing and outside this window; it needs a " +
      "correction with evidence, not a silent delete here.",
    spec: {
      kind: "long",
      sheet: "Master Detailed Sheet",
      headerMatch: /^Date$/i,
      dateFormat: "dd/mm/yyyy",
      cols: {
        date: 0, label: 1, category: 2, driver: 9,
        fills: [{ litres: 3, meter: 6 }, { litres: 4, meter: 7 }],
      },
    },
    aliases: {
      // The workbook's own Transcription Notes: "Almost certainly the same
      // 1 Cub. Written LL on 01/08 and 03/08 and LK on 02/08."
      "LK-0936": "LL-0936",

      // Each of the four below is settled by the ODOMETER, not by how close the
      // plate looks. Every one is a machine an earlier run of this site's sheet
      // already registered under a different reading of the same plate, so
      // matching them here is what stops a second phantom copy appearing.
      //
      // KT-3700: the sheet reads 32143 on 2 Aug, 302932 on 5 Aug and 33420 on
      // 10 Aug. KI-3700 holds 32143, 32932 and 33420 on 1, 4 and 9 Aug — the
      // same three figures one Colombo day apart, with a stray leading digit on
      // the middle one. Ten rows, 440 L.
      "KT-3700": "KI-3700",
      // LO-1718: 85 L at meter 143140 on 2 Aug. LD-1718 holds 85 L at 143140 on
      // 1 Aug. The same fill.
      "LO-1718": "LD-1718",
      // SR5-03: S read as 5. The sheet gives 1513 and 1515 on 11 and 12 Aug;
      // SRS-03 — a 10 Ton roller at this site, and the sheet says "10 Ton" —
      // holds exactly 1513 and 1515 on 10 and 11 Aug.
      "SR5-03": "SRS-03",
      // ZA-8969: one row, 20 L, 15 Aug, JCB, meter 1617.5, driver Thasitha.
      // LB-13 (ZA-7965) is the JCB that driver fuels all month, and its chain
      // runs 1613.0 on 13 Aug and 1621.7 on 16 Aug. 1617.5 sits between them.
      // The nearer-looking ZA-7969 is a phantom with no fuel at all and one
      // bogus reading of 15665 — LB-13's own 1566.5 with a lost decimal.
      "ZA-8969": "ZA-7965",
      // GE-841 is GE-84 with a stray keystroke — the site's generator, 46 fuel
      // rows to 9 Aug — and no GE-841 exists anywhere in the fleet. 5 L.
      "GE-841": "GE-84",
      // LO-1580 -> LP-1580 (DT-72). O read as P, which the one-digit-out matcher
      // cannot reach because it only substitutes digits. The workbook settles it
      // itself: it alternates between the two spellings for the same truck, same
      // driver (Sanjaya), on consecutive days —
      //   07 Aug LP-1580 91095.7 · 09 Aug LO-1580 91295.7 ·
      //   10 Aug LO-1580 91382.7 · 12 Aug LP-1580 91470.2
      // and DT-72 already holds all four of those readings, one Colombo day
      // apart. One odometer, one driver, two spellings. 3 rows, 90 L.
      "LO-1580": "LP-1580",
    },
    // This site's odometer column is its weakest field — eight readings in the
    // new range contradict the machine's own chain. Each one below is a single
    // mis-read digit, identified by where the figure has to sit between the
    // readings either side of it. The LITRES on every one of these lines are
    // imported; only the reading is dropped, because a wrong odometer is worse
    // than none — it silently distorts consumption and PM due-dates.
    untrustedMeters: new Set([
      // LB-20 runs 7173.8 on 14 Aug and 7182.9 on 16 Aug. 7198.9 cannot sit
      // between them; 7178.9 can, with a 7 read as a 9.
      "2026-08-15|ZB-1979",
      // HEX-22: 1302.6 the day after 1384.4, then no further readings to
      // arbitrate. Almost certainly 1392.6, but not certainly enough to store.
      "2026-08-14|HEX-22",
      // PH-6747 (HCC-07) is a crew cab in the 382,000-385,000 km band. Three of
      // its figures are not: 219083 is not an odometer reading at all; 384740 on
      // 23 Aug is 20 km below 21 Aug's 384760; and 383288 on 25 Aug is 1,500 km
      // below that again — 385288 with a 5 read as a 3. Its other five readings
      // (382737, 382810, 383182, 383800, 383990, 384760) are kept.
      "2026-08-15|PH-6747",
      "2026-08-23|PH-6747",
      "2026-08-25|PH-6747",
      // KT-3700's odometer is around 302,000-305,000 km — the sheet's 302932,
      // 304410, 304945, 305068 and 305187 form a clean series. Its 5-digit
      // figures are that same odometer with a digit lost: 32143, 33420 and this
      // 30386. The last is dropped; the 6-digit ones are kept.
      // Worth knowing: 32143 / 32932 / 33420 are ALREADY STORED on this machine
      // from the earlier load, so its history currently jumps ten-fold. That is
      // a correction, not something this importer should paper over.
      "2026-08-15|KT-3700",
      // SL-12 reads 5538.5 on 11 Aug and 5563.3 on 27 Aug. 5353.0 and 5358.0
      // are 5553.0 and 5558.0 — a 5 read as a 3, twice, and they land exactly
      // where they should once corrected. Dropped rather than corrected here.
      "2026-08-21|SL-12",
      "2026-08-23|SL-12",
    ]),
    trustSheetMeter: {
      "SL-13":
        "The stored 6869.2 from 12 Aug is the odd one out, not the new rows. " +
        "The sheet's own chain reads 6857.3 and 6858.4 on 10 and 11 Aug, then " +
        "6865.7, 6867.2, 6871.7, 6878.8, 6881.3, 6886.2 and 6892.4 from 14 Aug " +
        "onward — 1 to 2 hours a day throughout. 6869.2 sits above the two rows " +
        "that follow it and breaks that rate; everything after it is coherent.",
    },
    holdBack: {
      "226-3644":
        "Two different machines share this spelling and the meters prove it. On " +
        "5 and 6 Aug it reads 252378 and 252429 with driver Sabe, which are " +
        "226-3944's own figures on 4 and 5 Aug. On 21 and 25 Aug it has no " +
        "meter at all and driver Bandara, who drives 226-3544. Both are 1-cube " +
        "hire tippers on near-identical odometers, which is why they get " +
        "confused. The two metered rows are already imported; the other two " +
        "(30 L) need the site to say which truck it was.",
      "AD-1980":
        "One row, 30 L, 15 Aug, no meter. The sheet calls it a Tipper; the only " +
        "plate within reach is ZB-1980, which is LB-21, a backhoe loader posted " +
        "to CEP-03F. Wrong type and wrong site — a coincidence, not a match.",
      "LK-2615":
        "One row, 25 L, 21 Aug. No meter, no category (the sheet writes '-'), " +
        "and nothing in the fleet is within a digit of it.",
      "Lab":
        "5 L, 19 Aug, issued to the site laboratory. Real diesel, but not to a " +
        "machine — there is no asset to charge it to. Needs either a site-plant " +
        "asset or a decision to carry it as an unallocated site cost.",
      "(not recorded)":
        "The transcriber's own words. 3 L, 15 Aug, category '01 Ton'. The " +
        "storekeeper did not write down which machine.",
    },
  },
};
