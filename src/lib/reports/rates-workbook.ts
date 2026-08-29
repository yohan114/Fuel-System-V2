// The Fuel & Rental Rates workbook.
//
// The screen's "Export to Excel" button has pointed at /api/rates/xlsx since the
// page shipped, and the route was never written — the button has always
// answered with Next's 404 page. This builds what it should have returned.
//
// A workbook is not a screenshot of a table. Three things the screen does for
// readability actively break a spreadsheet, and are undone here:
//
//   * "—" for a missing figure turns the whole column into text, so it will not
//     sum, sort or chart. Missing means an EMPTY cell — null, never "" and never
//     an em dash.
//   * Rounding to the screen's 1 dp, and money through toLocaleString with
//     maximumFractionDigits 0, throws away the precision a reader needs to
//     re-derive a severity or reconcile a rate. Figures go in as numbers at 2 dp
//     (4 dp for storage-unit bands, which run to 0.208 L/km).
//   * Values hidden behind a hover (the machine codes on each portable class) or
//     truncated for width (type labels, the top-12 cut on the above-standard
//     panel) are carried in full.
//
// The unit trap is the one that could actually mislead. Econ / Standard / Heavy
// / Actual are DISPLAY figures: L/hr for machinery, km/L for road vehicles. The
// reciprocal reverses the ordering, so on a km/L row Econ is the largest number
// and higher is better, while on an L/hr row the opposite holds — and both sit
// in the same three columns. Anyone sorting or conditionally formatting those
// columns blind gets machinery right and road vehicles exactly backwards. So
// every row carries its own Band Unit and Actual Unit, and the storage-unit
// columns are kept beside them, where "higher is worse" is true on both bases.
//
// Band Unit and Actual Unit are separate columns for a second reason: on the
// ~95 machines carrying an hour band on a km odometer they genuinely disagree.
// The screen defuses that by withholding the verdict; a spreadsheet cannot, so
// the disagreement is shown rather than papered over.

import * as XLSX from "xlsx";
import type { RateBandRow, RatesOverview } from "../consumption/rates-overview";
import type { PortableOverview } from "../consumption/portable-overview";
import { PORTABLE_CARD_SOURCE, MATCH_LABEL, portableClassById } from "../consumption/portable-rate-card";
import {
  BAND_REASON_LABEL, HEAVY_MULTIPLE, MIN_INTERVALS_FOR_VERDICT, MIN_INTERVAL_DELTA,
  PLAUSIBLE_RATE, consBasisForMeter, displayUnit, storageUnit,
} from "../consumption/band";
import { colomboDayKey, fuelDateTime } from "../colombo-date";

export type Cell = string | number | null;

export interface RatesWorkbookInput {
  rows: RateBandRow[];
  counts: RatesOverview["counts"];
  litresMeasured: number;
  litresTotal: number;
  portable: PortableOverview;
  /** assetId → the rate card's stored fuelConsBasis, so the sheet can say
   *  whether a band's unit was stated or inferred from its magnitude. */
  rawBasis: Map<string, string | null>;
  generatedAt: Date;
  exportedBy: string;
}

export interface SheetSpec {
  name: string;
  aoa: Cell[][];
  /** Column widths, one per column. */
  widths: number[];
}

// These label maps live in the "use client" table components, which a server
// route may not import. Kept in step with them deliberately — the workbook and
// the screen must read identically or a reader will think they disagree.
const STATE_LABEL: Record<string, string> = {
  OVER: "over heavy",
  HEAVY: "above standard",
  NORMAL: "within band",
  BELOW_ECON: "below econ",
};

const REASON_LABEL: Record<string, string> = {
  "no-rate-card": "no rate card",
  "no-band": "no band set",
  "basis-conflict": "not comparable — hour band on a km meter",
};

const BASIS_LABEL: Record<string, string> = { d: "Dry", w: "Wet", fw: "Fully wet" };

const RATE_UNIT: Record<string, string> = { hourly: "per hour", perkm: "per km", perday: "per day" };

// Round the cents, THEN divide. Math.round(cents / 100) discards the cents on
// every row and again on the total, so the printed total stops equalling the
// column above it.
const lkr = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

const round1 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);
const round2 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 100) / 100);
// Storage figures need far more places than display ones. An L/km band runs
// from 0.05 to 0.455, so four decimals leaves the smallest of them on three
// significant figures and 0.05 on one — enough to change a derived rate.
const round6 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 1_000_000) / 1_000_000);

/** The verdict cell, word for word as the screen renders it. */
export function verdictOf(r: RateBandRow): string {
  if (r.state && STATE_LABEL[r.state]) return STATE_LABEL[r.state];
  return (
    REASON_LABEL[r.bandReason] ??
    // Singular even at 2, matching the screen. A reader comparing the two
    // should not have to wonder whether they are looking at the same thing.
    (r.intervals > 0 ? `${r.intervals} interval — need 3` : "not measured")
  );
}

/**
 * Whether the band's unit was stated on the rate card or guessed from its size.
 *
 * resolveBand infers a missing basis by magnitude — under 1 litre per unit it
 * must be per-km, above it per-hour. That is a sound rule and still a guess, and
 * somebody auditing an odd verdict needs to know which they are looking at.
 */
export function bandBasisSource(r: RateBandRow, rawBasis: Map<string, string | null>): string | null {
  if (!r.hasRateCard) return null;
  const raw = rawBasis.get(r.assetId);
  if (raw === "hr" || raw === "km") return "stored";
  return r.basis != null ? "inferred" : null;
}

const UNIT_NOTES = [
  "Econ / Standard / Heavy / Actual are display figures. Machinery is quoted in L/hr — higher is worse. Road vehicles (KM meters) are quoted in km/L — higher is better. Both appear in the same columns, so read Band Unit and Actual Unit before sorting, charting or conditionally formatting.",
  "On a “not comparable” row the band is quoted per hour while the meter counts kilometres, so Band Unit and Actual Unit differ on the same row and the two figures cannot be compared. Those rows carry Comparable = no and no verdict.",
  "Econ / Standard / Heavy (storage) are the values as held: litres per unit of work, L/hr or L/km. In storage units higher is always worse, on both bases. Severity is actual ÷ standard computed in storage units, so it is directionless — higher is always worse whatever the meter.",
  "Dry / Wet / Fully wet are rupees, and the unit differs row by row: Rate Unit says per hour, per km or per day. Never sum or average those columns across rows with different rate units.",
  "Portable plant has no fully-wet tier, so that cell is blank on those rows by construction, not by omission. The screen prints “n/a” there.",
];

const SHEET_NOTES: [string, string][] = [
  ["Summary", "Every count behind the screen's tiles, including the ones it does not show."],
  ["Machines", "One row per machine: consumption band, measured burn, verdict and the three hire tiers."],
  ["Above Standard", "Machines burning above their standard band, worst first — all of them, not the screen's first twelve."],
  ["Portable Card", "The 2026 portable equipment day-hire card: 36 capacity classes, wet and dry Rs/day."],
  ["Portable Fleet", "Portable plant in the fleet and which card class each machine sits on."],
  ["Legend", "Every label, threshold and filter used on the screen, spelled out."],
];

// ── Sheet 1: Cover ──────────────────────────────────────────────────────────

function coverSheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  const { counts, portable } = i;
  const aoa: Cell[][] = [
    [`Fuel & Rental Rates — ${dayKey}`],
    [],
    ["What each machine burns and what it is charged, on one screen. Consumption bands come from the 2026 Fleet Rental Prices workbook; the hire rates are set on the screen."],
    [],
    ["Generated", fuelDateTime(i.generatedAt)],
    ["Exported by", i.exportedBy],
    ["Scope", "Whole fleet — every asset in the register. Not filtered by site."],
    [],
    ["Read this before acting on a verdict"],
    ["• The standard bands are class estimates, not measurements. The workbook sets Typical from the machine's model size and age, then derives Econ and Heavy from it by a fixed ratio — so every dump truck in the fleet shares one band."],
    [`• A verdict needs at least ${MIN_INTERVALS_FOR_VERDICT} measured intervals. ${counts.total - counts.verdicts} machines have no verdict, almost all because the meter is never read when fuel is issued.`],
    [`• ${counts.basisConflict} machines carry an hour-based band while sitting on a km odometer, so their burn cannot be compared until the meter type is corrected. They are marked not comparable rather than given a misleading verdict.`],
    ["• Road vehicles are shown in km/L (higher is better), machinery in L/hr (lower is better) — matching the workbook."],
    [`• The ${portable.counts.total} portable machines are priced per day, not per hour, off a separate capacity card. They are in the Machines sheet like everything else, with Rate Unit reading "per day" and their Rs/day figures sitting in the same Dry and Wet columns as hourly and per-km rates — check Rate Unit before summing or averaging those columns. The Portable Card and Portable Fleet sheets carry the card itself and each machine's standing on it.`],
    [],
    ["Units"],
    ...UNIT_NOTES.map((n): Cell[] => [n]),
    [],
    ["Portable card source"],
    [PORTABLE_CARD_SOURCE],
    [],
    ["Sheets in this workbook"],
    ...SHEET_NOTES.map(([n, d]): Cell[] => [n, d]),
  ];
  return { name: "Cover", aoa, widths: [104, 28] };
}

// ── Sheet 2: Summary ────────────────────────────────────────────────────────

function summarySheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  const { rows, counts, portable } = i;
  const pct = i.litresTotal > 0 ? (100 * i.litresMeasured) / i.litresTotal : 0;
  const n = (p: (r: RateBandRow) => boolean) => rows.filter(p).length;

  const aoa: Cell[][] = [
    [`Fuel & Rental Rates — Summary — ${dayKey}`],
    [],
    ["Metric", "Value", "What it means"],
    [],
    ["Consumption"],
    ["Machines in the register", counts.total, null],
    ["Over standard (over heavy + above standard)", counts.over + counts.heavy, "The headline tile on the screen."],
    ["Over the heavy threshold", counts.over, null],
    ["Above standard, not over heavy", counts.heavy, null],
    ["Within band", counts.normal, null],
    ["Below econ", counts.belowEcon, null],
    ["With a verdict", counts.verdicts, `Needs at least ${MIN_INTERVALS_FOR_VERDICT} measured intervals and a comparable band.`],
    ["With a standard band", counts.withBand, "A band figure greater than zero on the rate card."],
    ["With a heavy threshold", counts.withHeavy, null],
    ["With at least one measured interval", counts.measured, null],
    ["No rate card at all", counts.noRateCard, "No rate card means no rental line and no consumption band. They still invoice fuel if the machine is flagged fuel-only, which bills fuel without a rate card."],
    ["Rate card but no band", counts.noBand, null],
    ["Hour band on a km meter (not comparable)", counts.basisConflict, "The workbook and the fleet register disagree. Fixing the meter type unlocks the check — correct them machine by machine; a bulk flip of the meter type is not safe."],
    [],
    ["Fuel"],
    ["Litres inside a measurable interval", i.litresMeasured, null],
    ["Litres issued, all machines", i.litresTotal, null],
    ["Fuel checked (%)", round1(pct), "Share of issued litres that falls inside an interval a burn rate could be measured from."],
    [],
    ["Pricing"],
    ["Priced wet", n((r) => r.wetCents != null), null],
    ["No wet rate", counts.total - n((r) => r.wetCents != null), null],
    ["Priced dry", n((r) => r.dryCents != null), null],
    ["Carrying a fully-wet rate", n((r) => r.fullyWetCents != null), null],
    ["Bills wet by default", n((r) => r.defaultBasis === "w"), null],
    ["Bills dry by default", n((r) => r.defaultBasis === "d"), null],
    ["Bills fully wet by default", n((r) => r.defaultBasis === "fw"), null],
    ["Default basis unset (falls to wet)", n((r) => !r.defaultBasis), null],
    ["No rate at all (all three tiers empty)", n((r) => r.dryCents == null && r.wetCents == null && r.fullyWetCents == null), "they invoice nothing for their work"],
    [],
    ["Portable plant"],
    ["Portable machines", portable.counts.total, null],
    ["Exactly on a card class", portable.counts.onCard, null],
    ["Dry rate only, wet never filled in", portable.counts.dryOnly, "Priced once, dry. A wet hire of one of these prices at nothing."],
    ["Wet rate only, no dry rate", portable.counts.wetOnly, null],
    ["Off the card entirely", portable.counts.offCard, "Their figures match no class on the 2026 card."],
    ["No rate at all", portable.counts.unpriced, null],
    ["A class identified, wet rate missing", portable.counts.fillable, "What the screen's fill button would write, and only into empty cells."],
    ["Would bill nothing today", portable.counts.billsNothing, "Given each machine's own default basis, the tier a bill would fall to is unset — the machine works and invoices zero."],
    [],
    ["Gaps to close"],
    ["No rate card at all", counts.noRateCard, "No rate card means no rental line and no consumption band. They still invoice fuel if the machine is flagged fuel-only, which bills fuel without a rate card."],
    ["Hour band on a km meter", counts.basisConflict, "The workbook and the fleet register disagree. Fixing the meter type unlocks the check."],
    ["Never measured (0 intervals)", counts.total - counts.measured, "Recording the meter at every fill is what turns these into a verdict."],
    ["No verdict (fewer than 3 intervals, or not comparable)", counts.total - counts.verdicts, "Never measured counts 0 intervals; no verdict is the wider set — it also includes machines with 1 or 2 intervals and machines whose band is not comparable."],
  ];
  return { name: "Summary", aoa, widths: [52, 12, 78] };
}

// ── Sheet 3: Machines ───────────────────────────────────────────────────────

const MACHINE_HEADERS = [
  "Machine", "Reg No", "Category", "Site",
  "Econ", "Standard", "Heavy", "Band Unit",
  "Actual", "Actual Unit", "Intervals", "Verdict", "Severity (×)",
  "Rate Unit", "Dry (LKR)", "Wet (LKR)", "Fully Wet (LKR)", "Bills On",
  "Status", "Meter Type", "Equip Type", "Charge Mode", "Has Rate Card", "Comparable",
  "Band Reason", "Band Reason (plain)", "State", "Band Basis", "Band Basis Source",
  "Storage Unit", "Econ (storage)", "Standard (storage)", "Heavy (storage)",
  "Total Litres", "Type Label", "Why Not Measured", "Asset ID",
];

const MACHINE_WIDTHS = [
  14, 12, 26, 26, 9, 10, 9, 10, 9, 11, 10, 34, 11,
  10, 12, 12, 14, 12, 10, 11, 11, 11, 13, 11,
  14, 46, 11, 11, 16, 12, 13, 16, 14, 12, 30, 62, 38,
];

export function machineRow(r: RateBandRow, rawBasis: Map<string, string | null>): Cell[] {
  return [
    r.code,
    r.regNo ?? null,
    r.categoryName ?? null,
    r.projectName ?? "unassigned",
    round2(r.econDisplay),
    round2(r.typDisplay),
    round2(r.heavyDisplay),
    // Gated on the STORAGE typ, exactly as the screen is. A towed trailer
    // stored at 0 L/hr has a band figure but no displayable one, so the unit
    // prints while the three band cells stay blank. That combination is
    // truthful: the card says "no consumption", not "unknown consumption".
    r.typ != null ? r.unit : null,
    round2(r.actualDisplay),
    displayUnit(consBasisForMeter(r.meterType)),
    r.intervals,
    verdictOf(r),
    // Gated on the VERDICT, not on the severity being non-zero. Severity is
    // computed from a single interval, while a verdict needs three — so a
    // machine measured once carries a severity the screen never shows. Publish
    // it and the column's own sort puts four never-measured machines above the
    // genuinely worst one, while the row beside it reads "1 interval — need 3".
    r.state != null && r.severity > 0 ? round2(r.severity) : null,
    RATE_UNIT[r.chargeMode] ?? r.chargeMode,
    lkr(r.dryCents),
    lkr(r.wetCents),
    lkr(r.fullyWetCents),
    (r.defaultBasis && BASIS_LABEL[r.defaultBasis]) || "unset → wet",
    r.status,
    r.meterType,
    r.equipType ?? null,
    r.chargeMode,
    r.hasRateCard ? "yes" : "no",
    r.comparable ? "yes" : "no",
    r.bandReason,
    BAND_REASON_LABEL[r.bandReason as keyof typeof BAND_REASON_LABEL] ?? r.bandReason,
    r.state ?? null,
    r.basis ?? null,
    bandBasisSource(r, rawBasis),
    storageUnit(r.basis ?? consBasisForMeter(r.meterType)),
    round6(r.econ),
    round6(r.typ),
    round6(r.heavy),
    round2(r.totalLitres),
    r.typeLabel ?? null,
    r.emptyReason ?? null,
    r.assetId,
  ];
}

function machinesSheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  const aoa: Cell[][] = [
    [`Fuel & Rental Rates — Machines — ${dayKey}`],
    [],
    MACHINE_HEADERS,
  ];
  for (const r of i.rows) aoa.push(machineRow(r, i.rawBasis));

  // Only two columns here are summable. The band columns are rates, severity is
  // a ratio, and Dry/Wet/Fully Wet mix Rs/hr, Rs/km and Rs/day in one column —
  // a total across those is a number with no meaning.
  const total: Cell[] = new Array(MACHINE_HEADERS.length).fill(null);
  total[0] = "TOTAL";
  total[1] = `${i.counts.total} machines`;
  total[10] = i.rows.reduce((s, r) => s + r.intervals, 0);
  total[33] = round2(i.rows.reduce((s, r) => s + r.totalLitres, 0));
  aoa.push([], total);

  return { name: "Machines", aoa, widths: MACHINE_WIDTHS };
}

// ── Sheet 4: Above Standard ─────────────────────────────────────────────────

function aboveStandardSheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  // Sorted by severity here rather than inherited from the overview, which
  // orders by state class first — every "over heavy" machine ahead of every
  // "above standard" one, whatever the numbers. That is a sensible triage order
  // on screen, and it makes a Rank column disagree with the Severity column
  // printed beside it. Ranked worst first means worst first.
  const hot = i.rows
    .filter((r) => r.state === "OVER" || r.state === "HEAVY")
    .sort((a, b) => b.severity - a.severity || a.code.localeCompare(b.code));
  const aoa: Cell[][] = [
    [
      `Burning Above Standard — ${dayKey}`,
    ],
    [
      `The screen shows the first 12 of these; this sheet lists all ${hot.length}. Ranked by severity, worst first — ` +
        `the screen instead groups every over-heavy machine ahead of every above-standard one, so the first rows here may differ from the panel.`,
    ],
    [],
    ["Rank", "Machine", "Category", "Site", "Actual", "Actual Unit", "Standard", "Band Unit", "Severity (×)", "Intervals", "Verdict"],
  ];
  if (hot.length === 0) {
    aoa.push(["No machine is burning above its standard band."]);
  } else {
    hot.forEach((r, idx) => {
      aoa.push([
        idx + 1,
        r.code,
        r.categoryName ?? null,
        r.projectName ?? "unassigned",
        round2(r.actualDisplay),
        displayUnit(consBasisForMeter(r.meterType)),
        round2(r.typDisplay),
        r.typ != null ? r.unit : null,
        round2(r.severity),
        r.intervals,
        verdictOf(r),
      ]);
    });
  }
  return { name: "Above Standard", aoa, widths: [6, 14, 26, 26, 9, 11, 10, 10, 11, 10, 34] };
}

// ── Sheet 5: Portable Card ──────────────────────────────────────────────────

function portableCardSheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  const { classes } = i.portable;
  const aoa: Cell[][] = [
    [`Portable Equipment — Day-Hire Card — ${dayKey}`],
    ["Portable plant carries no meter anybody reads, so it is not priced by the hour or the kilometre — it goes out for a day at a flat rate. Wet includes fuel or power, an operator and routine consumables; Dry is the bare machine. Both exclude 18% VAT and transport, and a part day bills as a full one."],
    [PORTABLE_CARD_SOURCE],
    // In Fleet counts only machines whose own figures match a class, so its
    // total is below the fleet count whenever a machine is off the card. Saying
    // so here stops the two totals reading as a contradiction.
    [
      `In Fleet counts the machines whose own rates sit on that class: ${i.portable.classes.reduce((s, k) => s + k.fleetCount, 0)} of ` +
        `${i.portable.counts.total} portable machines. The rest are off the card and are listed on the Portable Fleet sheet.`,
    ],
    [],
    ["Category", "Capacity / Size", "Wet (LKR/day)", "Dry (LKR/day)", "Billing", "Minimum", "Powered", "In Fleet", "Machine Codes", "Basis of the Figure", "Class ID"],
  ];
  for (const k of classes) {
    aoa.push([
      // The screen blanks a repeated category for visual grouping. A sheet that
      // does the same cannot be filtered or pivoted.
      k.category,
      k.size,
      lkr(k.wetCents),
      lkr(k.dryCents),
      k.billing,
      k.minimum,
      // Without this the three lines where wet equals dry look like a typo.
      k.nonPowered ? "no — wet equals dry" : "yes",
      k.fleetCount,
      k.codes.length ? k.codes.join(", ") : null,
      k.note,
      k.id,
    ]);
  }
  const total: Cell[] = new Array(11).fill(null);
  total[0] = "TOTAL";
  total[1] = `${classes.length} classes`;
  total[7] = classes.reduce((s, k) => s + k.fleetCount, 0);
  aoa.push([], total);

  return { name: "Portable Card", aoa, widths: [26, 46, 15, 15, 13, 10, 20, 9, 30, 62, 24] };
}

// ── Sheet 6: Portable Fleet ─────────────────────────────────────────────────

function portableFleetSheet(i: RatesWorkbookInput, dayKey: string): SheetSpec {
  const { machines, counts } = i.portable;
  const aoa: Cell[][] = [
    [`Portable Plant in the Fleet — ${dayKey}`],
    [
      `${counts.total} portable machines. ${counts.onCard} sit exactly on a card class. ` +
        `${counts.dryOnly} carry the dry figure with the wet side never filled in — hire one of those out wet and it prices at nothing. ` +
        `${counts.offCard} are off the card entirely.`,
    ],
    [],
    [
      "Machine", "Register Category", "Type Label", "Site",
      "Wet (LKR/day)", "Dry (LKR/day)", "Bills On", "Card Class", "Standing", "Match",
      "Card Category", "Matched Class ID", "Card Wet (LKR/day)", "Card Dry (LKR/day)",
      "Bills Nothing Today", "Status", "Asset ID",
    ],
  ];
  for (const m of machines) {
    const cls = m.matchedClassId ? portableClassById(m.matchedClassId) : null;
    // The tier a bill actually falls to, given this machine's own default. An
    // unset default falls to wet, so a wet-less machine invoices zero — which
    // is the single most consequential fact on this sheet and appears nowhere
    // on the screen.
    const effective = (m.defaultBasis ?? "w") === "d" ? m.dryCents : m.wetCents;
    aoa.push([
      m.code,
      m.categoryName ?? null,
      m.typeLabel ?? null,
      m.projectName ?? "unassigned",
      lkr(m.wetCents),
      lkr(m.dryCents),
      // "fw" needs saying rather than falling into the unset bucket: portable
      // plant has no fully-wet tier, so pickRateCents reads the wet rate for it.
      // The bill is the same either way; calling it "unset" would not be.
      m.defaultBasis === "d" ? "Dry"
        : m.defaultBasis === "w" ? "Wet"
        : m.defaultBasis === "fw" ? "Fully wet → wet (portable has no fully-wet tier)"
        : "unset → wet",
      cls ? `${cls.category} · ${cls.size}` : null,
      MATCH_LABEL[m.match as keyof typeof MATCH_LABEL] ?? m.match,
      m.match,
      m.cardCategory ?? null,
      m.matchedClassId ?? null,
      lkr(m.cardWetCents),
      lkr(m.cardDryCents),
      effective == null ? "yes" : "no",
      m.status,
      m.assetId,
    ]);
  }
  const total: Cell[] = new Array(17).fill(null);
  total[0] = "TOTAL";
  total[1] = `${machines.length} machines`;
  total[14] = `${counts.billsNothing} bill nothing`;
  aoa.push([], total);

  return { name: "Portable Fleet", aoa, widths: [14, 26, 30, 26, 15, 15, 13, 34, 30, 11, 26, 24, 17, 17, 19, 10, 38] };
}

// ── Sheet 7: Legend ─────────────────────────────────────────────────────────

function legendSheet(): SheetSpec {
  const aoa: Cell[][] = [
    ["Legend — Labels, Units and Thresholds"],
    [],
    ["Group", "Key", "Meaning"],
    ["Verdict", "OVER", "over heavy — burning above the heavy threshold"],
    ["Verdict", "HEAVY", "above standard — between the standard band and the heavy threshold"],
    ["Verdict", "NORMAL", "within band"],
    ["Verdict", "BELOW_ECON", "below econ — burning less than the economic figure"],
    ["Verdict", "NO_METER / NO_BAND", "Defined in ConsumptionState but never reach this sheet: a machine with no meter or no band gets no verdict at all."],
    ["No verdict", "no rate card", "No rate card exists, so there is no band to compare against."],
    ["No verdict", "no band set", "A rate card exists but carries no consumption figure."],
    ["No verdict", "not comparable — hour band on a km meter", "The band is quoted per hour, the meter counts kilometres. Comparing them would be a 45x error, so no verdict is given."],
    ["No verdict", "N interval — need 3", `Measured, but on fewer than ${MIN_INTERVALS_FOR_VERDICT} intervals.`],
    ["No verdict", "not measured", "No usable fill-to-fill interval — almost always because the meter is not read when fuel is issued."],
    ["Band reason", "ok", BAND_REASON_LABEL.ok],
    ["Band reason", "no-rate-card", BAND_REASON_LABEL["no-rate-card"]],
    ["Band reason", "no-band", BAND_REASON_LABEL["no-band"]],
    ["Band reason", "basis-conflict", BAND_REASON_LABEL["basis-conflict"]],
    ["Band reason", "not-metered", `${BAND_REASON_LABEL["not-metered"]} (defined but never returned by resolveBand)`],
    ["Portable standing", "exact", MATCH_LABEL.exact],
    ["Portable standing", "dry-only", MATCH_LABEL["dry-only"]],
    ["Portable standing", "wet-only", MATCH_LABEL["wet-only"]],
    ["Portable standing", "off-card", MATCH_LABEL["off-card"]],
    ["Portable standing", "unpriced", MATCH_LABEL.unpriced],
    ["Bills on", "d", "Dry"],
    ["Bills on", "w", "Wet"],
    ["Bills on", "fw", "Fully wet"],
    ["Bills on", "(unset)", "unset → wet. Billing falls back to the wet tier. A posting marked otherwise still wins for its own days."],
    ["Rate unit", "hourly", "per hour"],
    ["Rate unit", "perkm", "per km"],
    ["Rate unit", "perday", "per day"],
    ["Rate unit", "how it is chosen", "Mirrors the billing engine: portable plant is per day whatever meter it carries; a KM meter is per km; everything else is hourly. Per-day rows read the portable rate pair only — the generic daily columns are never used for portable plant."],
    ["Screen filter", "All", "no filter"],
    ["Screen filter", "Over standard", "State is OVER or HEAVY"],
    ["Screen filter", "Measured", "Intervals is not zero"],
    ["Screen filter", "No band", "Band Reason is no-band"],
    ["Screen filter", "Not comparable", "Band Reason is basis-conflict"],
    ["Screen filter", "No rate card", "Band Reason is no-rate-card"],
    // These are the ratios the 2026 workbook used to DERIVE each heavy
    // threshold from its typical figure. They are not what the verdict tests:
    // a machine is "over heavy" when its measured burn exceeds the heavy figure
    // stored on its own rate card, which may have been edited since.
    ["Threshold", "Heavy multiple (hours)", `${HEAVY_MULTIPLE.hr}× typical — the ratio the 2026 workbook used to derive a machine's heavy figure. The verdict compares the measured burn against the heavy figure stored on the rate card, not against this ratio.`],
    ["Threshold", "Heavy multiple (km)", `${HEAVY_MULTIPLE.km}× typical — the same derivation for road vehicles, after inverting km/L to L/km.`],
    ["Threshold", "How the verdict is decided", "Over heavy: measured burn above the card's Heavy figure. Above standard: above Standard but not above Heavy. Below econ: below the Econ figure. Within band: none of those. All four comparisons are made in storage units."],
    ["Threshold", "Intervals needed for a verdict", MIN_INTERVALS_FOR_VERDICT],
    ["Threshold", "Smallest usable interval (hours)", `${MIN_INTERVAL_DELTA.hr} hours`],
    ["Threshold", "Smallest usable interval (km)", `${MIN_INTERVAL_DELTA.km} km`],
    ["Threshold", "Plausible burn (hours)", `${PLAUSIBLE_RATE.hr.min}–${PLAUSIBLE_RATE.hr.max} L/hr; anything outside is a transcription error, not a machine.`],
    ["Threshold", "Plausible burn (km)", `${PLAUSIBLE_RATE.km.min}–${PLAUSIBLE_RATE.km.max} L/km (20 down to 2 km/L).`],
    ...UNIT_NOTES.map((n, idx): Cell[] => ["Units", `Note ${idx + 1}`, n]),
  ];
  return { name: "Legend", aoa, widths: [26, 34, 96] };
}

// ── assembly ────────────────────────────────────────────────────────────────

export function buildRatesSheets(input: RatesWorkbookInput): SheetSpec[] {
  const dayKey = colomboDayKey(input.generatedAt);
  return [
    coverSheet(input, dayKey),
    summarySheet(input, dayKey),
    machinesSheet(input, dayKey),
    aboveStandardSheet(input, dayKey),
    portableCardSheet(input, dayKey),
    portableFleetSheet(input, dayKey),
    legendSheet(),
  ];
}

export function buildRatesWorkbook(input: RatesWorkbookInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of buildRatesSheets(input)) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    ws["!cols"] = s.widths.map((wch) => ({ wch }));
    // The title spans the table so it reads as a title rather than as a very
    // long value in column A.
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, s.widths.length - 1) } }];
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}

export function ratesWorkbookFilename(generatedAt: Date): string {
  return `fuel-rental-rates-${colomboDayKey(generatedAt)}.xlsx`;
}

// ── the one-page export ─────────────────────────────────────────────────────
//
// The seven-sheet workbook answers "give me everything". This answers the more
// common question — "give me the table I am looking at" — as a single sheet
// that mirrors the screen: the same columns in the same order, the same rows in
// the same order, honouring whatever filter and search were active.
//
// Four columns exist here that are not separate boxes on screen, because a
// spreadsheet cannot do what a rendered cell does:
//
//   Reg No       — printed beside the machine code in one cell on screen; its
//                  own column here so it can be sorted and looked up.
//   Severity (×) — rendered inside the verdict badge as " · 1.68×"; a number of
//                  its own here so the column can be sorted.
//   Rate Unit    — the screen writes the unit into each figure as "45/km", but a
//                  column holding 45/km beside 2,000/hr beside 6,000/day is only
//                  safe to read once the unit is a field.
//   Actual Unit  — the same problem, and the one the screen genuinely does not
//                  solve. Its single Unit column states the BAND's unit and is
//                  blank when a machine has no band, while the Actual figure
//                  beside it is populated from the METER regardless. That leaves
//                  a bare number that is L/hr on one row and km/L on the next
//                  with nothing to tell them apart — so Actual gets its own unit
//                  column, derived from the meter and never blank.

export interface RatesTableSheetInput {
  /** Already filtered and in screen order. */
  rows: RateBandRow[];
  /** One line describing the filter and search that produced these rows. */
  scopeNote: string;
  generatedAt: Date;
  exportedBy: string;
}

const TABLE_HEADERS = [
  "Machine", "Reg No", "Category",
  "Econ", "Standard", "Heavy", "Unit",
  "Actual", "Actual Unit", "Intervals", "Verdict", "Severity (×)",
  "Rate Unit", "Dry (LKR)", "Wet (LKR)", "Fully Wet (LKR)", "Bills On",
];

const TABLE_WIDTHS = [14, 12, 24, 9, 10, 9, 9, 9, 11, 10, 34, 11, 10, 12, 12, 14, 12];

export function buildRatesTableSheet(i: RatesTableSheetInput): SheetSpec {
  const dayKey = colomboDayKey(i.generatedAt);
  const aoa: Cell[][] = [
    [`Fuel & Rental Rates — ${dayKey}`],
    [i.scopeNote],
    [
      `Econ / Standard / Heavy are in the Unit column and Actual is in the Actual Unit column — L/hr for machinery (higher is worse), km/L for road vehicles (higher is better). ` +
        `The two differ on a machine whose band is quoted per hour while its meter counts kilometres, and Unit is blank where there is no band at all. ` +
        `Dry / Wet / Fully wet are rupees in the Rate Unit column — per hour, per km or per day — so never sum or average those columns across rows with different rate units. ` +
        `A blank Fully Wet on a per-day row means portable plant has no fully-wet tier, not that one is unpriced; the screen prints “n/a” there. ` +
        `Exported by ${i.exportedBy}, ${fuelDateTime(i.generatedAt)}.`,
    ],
    [],
    TABLE_HEADERS,
  ];

  for (const r of i.rows) {
    aoa.push([
      r.code,
      r.regNo ?? null,
      r.categoryName ?? null,
      round2(r.econDisplay),
      round2(r.typDisplay),
      round2(r.heavyDisplay),
      r.typ != null ? r.unit : null,
      round2(r.actualDisplay),
      // From the meter, not the band, so it is never blank and never disagrees
      // with the figure it labels.
      displayUnit(consBasisForMeter(r.meterType)),
      r.intervals,
      verdictOf(r),
      // Same gate as the screen: the figure only appears inside a verdict badge,
      // so a machine measured once too few times shows the words and no number.
      r.state != null && r.severity > 0 ? round2(r.severity) : null,
      RATE_UNIT[r.chargeMode] ?? r.chargeMode,
      lkr(r.dryCents),
      lkr(r.wetCents),
      lkr(r.fullyWetCents),
      (r.defaultBasis && BASIS_LABEL[r.defaultBasis]) || "unset → wet",
    ]);
  }

  // Only the interval count can honestly be added up. Bands are rates, severity
  // is a ratio, and the three money columns mix Rs/hr, Rs/km and Rs/day.
  const total: Cell[] = new Array(TABLE_HEADERS.length).fill(null);
  total[0] = "TOTAL";
  total[1] = `${i.rows.length} machine${i.rows.length === 1 ? "" : "s"}`;
  total[TABLE_HEADERS.indexOf("Intervals")] = i.rows.reduce((s, r) => s + r.intervals, 0);
  aoa.push([], total);

  if (i.rows.length === 0) {
    // Placed relative to the header row rather than at a counted offset —
    // adding a line of prose above the table used to shift every such index.
    aoa.splice(aoa.indexOf(TABLE_HEADERS) + 1, 0, ["No machine matches that filter."]);
  }

  return { name: "Fuel & Rental Rates", aoa, widths: TABLE_WIDTHS };
}

export function buildRatesTableWorkbook(input: RatesTableSheetInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const s = buildRatesTableSheet(input);
  const ws = XLSX.utils.aoa_to_sheet(s.aoa);
  ws["!cols"] = s.widths.map((wch) => ({ wch }));
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: s.widths.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: s.widths.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: s.widths.length - 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, s.name);
  return wb;
}

export function ratesTableFilename(generatedAt: Date): string {
  return `fuel-rental-rates-table-${colomboDayKey(generatedAt)}.xlsx`;
}
