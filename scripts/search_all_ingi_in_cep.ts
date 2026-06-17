import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const UPLOADS = process.cwd();
const FILES = [
  "CEP-03 A,B and C - January 2026.xlsx",
  "CEP-03 A,B and C - February 2026.xlsx",
  "CEP-03 A,B and C - March 2026.xlsx"
];
const INGI_VEHICLES = ["ZA-0447", "PA-6399", "SL-10", "ZB-1521", "LP-1577", "PA-4879"];

function main() {
  for (const file of FILES) {
    const fp = path.join(UPLOADS, file);
    if (!fs.existsSync(fp)) continue;
    const wb = XLSX.readFile(fp, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\nFile: ${file}`);
    for (const v of INGI_VEHICLES) {
      let found = false;
      for (const [idx, r] of rows.entries()) {
        const row = r as unknown[];
        if (row.some(c => String(c).replace(/[\s\-_]/g, "").toUpperCase() === v.replace(/[\s\-_]/g, "").toUpperCase())) {
          console.log(`  - ${v} found at row ${idx}:`, row.slice(0, 12));
          found = true;
        }
      }
      if (!found) {
        // console.log(`  - ${v} NOT found`);
      }
    }
  }
}

main();
