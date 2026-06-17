import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const UPLOADS = process.cwd();
const FILES = [
  "CEP-03 A,B and C - January 2026.xlsx",
  "CEP-03 A,B and C - February 2026.xlsx",
  "CEP-03 A,B and C - March 2026.xlsx"
];

function main() {
  for (const file of FILES) {
    const fp = path.join(UPLOADS, file);
    if (!fs.existsSync(fp)) {
      console.log(`${file} not found`);
      continue;
    }
    const wb = XLSX.readFile(fp, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\nFile: ${file}`);
    let found = false;
    for (const [idx, r] of rows.entries()) {
      const row = r as unknown[];
      if (row.some(c => String(c).includes("LP-1577") || String(c).includes("LP1577"))) {
        console.log(`  Row ${idx}:`, row);
        found = true;
      }
    }
    if (!found) {
      console.log("  LP-1577 NOT FOUND");
    }
  }
}

main();
