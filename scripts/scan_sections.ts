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
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\n=== File: ${filename} ===`);
    
    rows.forEach((row, idx) => {
      const r = row as unknown[];
      const isHeader = typeof r[1] === "string" && r[1].toLowerCase().includes("vehicle no");
      if (isHeader) {
        console.log(`Header row index: ${idx}`);
      }
      
      const containsExternal = r.some(c => typeof c === "string" && c.toLowerCase().includes("external"));
      if (containsExternal) {
        console.log(`Row ${idx} has External:`, r.slice(0, 10));
      }
      
      const containsTotals = r.some(c => typeof c === "string" && (c.toLowerCase() === "totals" || c.toLowerCase() === "total"));
      if (containsTotals) {
        console.log(`Row ${idx} has Totals:`, r.slice(0, 10));
      }
    });
  }
}

main();
