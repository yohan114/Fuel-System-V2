import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILE = path.join(process.cwd(), "temp-uploads", "56342016-01_January_2026.xlsb");

function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Daily file not found!");
    return;
  }
  const wb = XLSX.readFile(FILE, { cellDates: false });
  // Find sheet that matches MG-06
  const sheetName = wb.SheetNames.find(n => n.toUpperCase().replace(/[\s\-_]/g, "") === "MG06");
  if (!sheetName) {
    console.error("MG-06 sheet not found in daily file!");
    return;
  }
  console.log(`Found sheet: "${sheetName}"`);
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  
  // Print header and daily rows
  rows.slice(0, 45).forEach((r, idx) => {
    console.log(`[${idx}]:`, r.slice(0, 15));
  });
}

main();
