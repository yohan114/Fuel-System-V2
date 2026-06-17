import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILE = path.join(process.cwd(), "Inginimitiya Vehicle, Machinery summary.xlsx");

function main() {
  if (!fs.existsSync(FILE)) return;
  const wb = XLSX.readFile(FILE, { cellDates: false });
  
  for (const sn of ["March 2026", "April 2026"]) {
    const sheet = wb.Sheets[sn];
    if (!sheet) {
      console.log(`Sheet "${sn}" not found!`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\n=========================================`);
    console.log(`Sheet: ${sn} | Rows: ${rows.length}`);
    rows.forEach((r, idx) => {
      console.log(`Row ${idx}:`, r.map(c => typeof c === "string" ? c.trim() : c));
    });
  }
}

main();
