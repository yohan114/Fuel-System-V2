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
    if (!fs.existsSync(filePath)) {
      console.error(`File ${filename} not found!`);
      continue;
    }
    const wb = XLSX.readFile(filePath, { cellDates: false });
    console.log(`\n=========================================`);
    console.log(`File: ${filename}`);
    console.log(`Sheet Names:`, wb.SheetNames);
    
    // Check the first sheet in detail
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`Sheet: ${sheetName}`);
    console.log(`Total Rows: ${rows.length}`);
    
    // Print first 15 rows to understand the layout
    rows.slice(0, 15).forEach((r, idx) => {
      console.log(`Row ${idx}:`, r.slice(0, 12));
    });
  }
}

main();
