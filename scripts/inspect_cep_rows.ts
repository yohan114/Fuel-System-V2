import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILES = [
  "CEP-03 A,B and C - January 2026.xlsx",
  "CEP-03 A,B and C - February 2026.xlsx",
  "CEP-03 A,B and C - March 2026.xlsx"
];

function main() {
  for (const filename of FILES) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames[0]; // 'Machinery '
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\n=========================================`);
    console.log(`File: ${filename} | Sheet: "${sheetName}" | Rows: ${rows.length}`);
    rows.forEach((r, idx) => {
      // Print the index and row elements
      console.log(`[${idx}]:`, r.map(c => typeof c === "string" ? c.trim() : c));
    });
  }
}

main();
