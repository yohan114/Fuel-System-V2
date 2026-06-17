import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILE = path.join(process.cwd(), "Inginimitiya Vehicle, Machinery summary.xlsx");

const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");

function detectColumns(header: unknown[]) {
  const find = (pred: (s: string) => boolean) =>
    header.findIndex((c) => typeof c === "string" && pred(c.toLowerCase()));
  let units = find((s) => s.includes("actual") && (s.includes("working") || s.includes("days") || s.includes("hours")));
  if (units < 0) units = find((s) => s.includes("machine hours") || s.includes("days/machine"));
  return {
    veh: find((s) => s.includes("vehicle no")) >= 0 ? find((s) => s.includes("vehicle no")) : 1,
    type: find((s) => s === "type") >= 0 ? find((s) => s === "type") : 2,
    units,
    fuel: find((s) => s.trim() === "fuel"),
    rate: find((s) => s.includes("rate")),
  };
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.log("File not found!");
    return;
  }
  const wb = XLSX.readFile(FILE, { cellDates: false });
  for (const sn of ["March 2026", "April 2026"]) {
    const sheet = wb.Sheets[sn];
    if (!sheet) {
      console.log(`Sheet ${sn} not found!`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\n--- Sheet: ${sn} ---`);
    const cols = detectColumns(rows[2] || []);
    console.log("Detected Columns:", cols);
    for (const [idx, row] of rows.slice(3).entries()) {
      const r = row as unknown[];
      if (r.some((c) => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) {
        console.log(`Row ${idx+3}: Hit external limit, stopping!`);
        break;
      }
      const rawCode = String(r[cols.veh] || "").trim();
      if (!rawCode) {
        console.log(`Row ${idx+3}: empty code`);
        continue;
      }
      if (!/^[A-Z0-9-]+$/i.test(rawCode)) {
        console.log(`Row ${idx+3}: invalid code "${rawCode}"`);
        continue;
      }
      const type = String(r[cols.type] || "Vehicle").trim() || "Vehicle";
      const units = cols.units >= 0 ? toFloat(r[cols.units]) : 0;
      const litres = cols.fuel >= 0 ? toFloat(r[cols.fuel]) : 0;
      const rateVal = cols.rate >= 0 ? toFloat(r[cols.rate]) : 0;
      console.log(`Row ${idx+3}: veh="${rawCode}", type="${type}", units=${units}, litres=${litres}, rate=${rateVal}`);
    }
  }
}

main();
