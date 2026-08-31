import * as XLSX from "xlsx";
import * as path from "node:path";

// Reader for "long" fuel registers: one sheet line is one refuel (or, on the
// Batticaloa form, two).
//
// Every site workbook in D:/Projects sites duplicates its data — a combined
// register PLUS a tab per day, or a monthly grid PLUS a tab per day. This reader
// takes exactly the view the profile names and never walks wb.SheetNames looking
// for more. That single rule is what stops nine separate double-counts, so the
// two ways of naming a view are deliberately exclusive: `sheet` (one named
// sheet, dates in a column) or `sheets` (a regex over dated tabs, date from the
// tab name). Never both.

export type Fill = {
  sheet: string;
  excelRow: number;        // 1-based, as Excel shows it — so a report line can be looked up
  day: string;             // yyyy-mm-dd, Colombo calendar day
  label: string;           // vehicle/machine as written on the sheet
  category: string;        // the sheet's own category word, "" when it has none
  litres: number;
  meter: number | null;
  driver: string;
  nth: number;             // 1 or 2 — which fill on the line
  note: string;
};

export type FillCols = { litres: number; meter?: number };

export type LongSpec = {
  kind: "long";

  /** One named sheet whose date lives in a column. Mutually exclusive with `sheets`. */
  sheet?: string;
  /** Dated tabs. The date comes from the tab NAME, not from any column. */
  sheets?: { match: RegExp; day: (sheetName: string) => string };

  /** Locate the header row by matching a cell on it. Never a fixed offset: one of
   *  these workbooks has its header on row 4 with a genuinely blank row above,
   *  and a hard-coded slice silently eats the first data row of every sheet. */
  headerMatch: RegExp;

  cols: {
    date?: number;         // required when `sheet` is used
    label: number;
    category?: number;
    driver?: number;
    note?: number;
    /** One entry per fill the line can carry. Two entries = the 1st/2nd form. */
    fills: FillCols[];
  };

  /** Required — never inferred. "01/08/2026" is 1 August here and 8 January in
   *  another convention, and guessing wrong is silent. */
  dateFormat: "serial" | "dd/mm/yyyy" | "dd-mm-yyyy" | "yyyy-mm-dd" | "yyyy.mm.dd";

  /** Force the year, for a workbook whose dates are provably mistyped. Documented
   *  in the profile with its evidence; never applied by guesswork. */
  dateYearOverride?: number;

  /** The site whose "meter" column is the tank's own cumulative totaliser. */
  ignoreMeterColumn?: boolean;

  /** Drop a row before anything else looks at it — the declarative, reviewable
   *  place to strip another site's page out of a shared workbook. */
  rowFilter?: (r: unknown[], ctx: { sheet: string; excelRow: number }) => boolean;

  /** Labels that are not machines (activities, transfers, headings). */
  skipLabels?: string[];
};

const S = (v: unknown) => String(v ?? "").trim();

/** Excel serial -> yyyy-mm-dd. Day 0 is 30 Dec 1899 in Excel's calendar. */
const fromSerial = (n: number) =>
  new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000)).toISOString().slice(0, 10);

export function parseDay(v: unknown, fmt: LongSpec["dateFormat"]): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const raw = S(v);
  if (!raw) return null;

  if (fmt === "serial") {
    const n = Number(raw);
    return Number.isFinite(n) && n > 40_000 && n < 60_000 ? fromSerial(n) : null;
  }

  // A cell typed as a date still arrives as a serial even when the profile says
  // the column is text, because whoever last edited the sheet reformatted it.
  const n = Number(raw);
  if (Number.isFinite(n) && n > 40_000 && n < 60_000) return fromSerial(n);

  const seps: Record<string, RegExp> = {
    "dd/mm/yyyy": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    "dd-mm-yyyy": /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    "yyyy.mm.dd": /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/,
    "yyyy-mm-dd": /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  };
  const m = raw.match(seps[fmt]);
  if (!m) return null;
  const [y, mo, d] = fmt.startsWith("yyyy")
    ? [m[1], m[2], m[3]]
    : [m[3], m[2], m[1]];
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  // Reject 31 February rather than let Date roll it forward into March.
  const back = new Date(`${iso}T00:00:00Z`);
  return back.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "N/W" (meter broken), "-" (none fitted), "N/A" and blank are not numbers and
 *  must not become 0. Only a positive finite number is a reading. */
export function parseMeter(v: unknown): number | null {
  const raw = S(v);
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readLong(file: string, spec: LongSpec): Fill[] {
  const wb = XLSX.readFile(file);
  const base = path.basename(file);

  const names: string[] = spec.sheets
    ? wb.SheetNames.filter((n) => spec.sheets!.match.test(n))
    : [spec.sheet!];
  if (!names.length) throw new Error(`${base}: no sheet matched`);

  const out: Fill[] = [];
  const skip = new Set((spec.skipLabels ?? []).map((s) => s.toLowerCase()));

  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`${base}: sheet "${name}" not found — it has ${wb.SheetNames.join(", ")}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });

    const headerAt = rows.findIndex((r) => r.some((c) => spec.headerMatch.test(S(c))));
    if (headerAt < 0) throw new Error(`${base} / ${name}: no header row matched ${spec.headerMatch}`);

    const sheetDay = spec.sheets ? spec.sheets.day(name) : null;

    for (let i = headerAt + 1; i < rows.length; i++) {
      const r = rows[i];
      const excelRow = i + 1;
      if (spec.rowFilter && !spec.rowFilter(r, { sheet: name, excelRow })) continue;

      const label = S(r[spec.cols.label]);
      if (!label || skip.has(label.toLowerCase())) continue;

      // A row without a usable date is a TOTAL line, a subtotal, or the blank
      // tail of the sheet. Dropping it is how those are excluded — there is no
      // separate "stop here" marker to trust.
      let day = sheetDay ?? parseDay(r[spec.cols.date!], spec.dateFormat);
      if (!day) continue;
      if (spec.dateYearOverride) day = `${spec.dateYearOverride}${day.slice(4)}`;

      spec.cols.fills.forEach((f, idx) => {
        const litres = Number(S(r[f.litres]));
        if (!Number.isFinite(litres) || litres <= 0) return;   // 0 = the line had no 2nd fill
        out.push({
          sheet: name,
          excelRow,
          day,
          label,
          category: spec.cols.category != null ? S(r[spec.cols.category]) : "",
          litres,
          meter: spec.ignoreMeterColumn || f.meter == null ? null : parseMeter(r[f.meter]),
          driver: spec.cols.driver != null ? S(r[spec.cols.driver]) : "",
          nth: idx + 1,
          note: spec.cols.note != null ? S(r[spec.cols.note]) : "",
        });
      });
    }
  }
  return out;
}
