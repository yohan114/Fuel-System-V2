import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const UPLOADS = path.join(process.cwd(), "temp-uploads");
const DAILY_FILES = [
  "56342016-01_January_2026.xlsb",
  "45058aff-02_February_2026.xlsb",
  "2d481ceb-03_March_2026.xlsb",
  "2ff1764f-04_April_2026.xlsb",
  "f4e0302f-05_May_2026.xlsb"
];

const CEP_ABC_FILES = [
  "CEP-03 A,B and C - January 2026.xlsx",
  "CEP-03 A,B and C - February 2026.xlsx",
  "CEP-03 A,B and C - March 2026.xlsx"
];

const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");

function main() {
  const dailyVehicles = new Set<string>();
  const uploadsDir = fs.existsSync(UPLOADS) ? UPLOADS : process.cwd();

  for (const filename of DAILY_FILES) {
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) continue;
    const wb = XLSX.readFile(filePath, { cellDates: false });
    wb.SheetNames.forEach(sheetName => {
      const key = stripCode(sheetName);
      if (key && key !== "SUMMARY" && key !== "SHEET1" && key !== "DATA") {
        dailyVehicles.add(key);
      }
    });
  }

  const abcVehicles = new Set<string>();
  for (const filename of CEP_ABC_FILES) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    let headerIdx = 2;
    const headerRow = rows[headerIdx];
    const vehCol = headerRow.findIndex(c => String(c).toLowerCase().includes("vehicle no"));
    
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      if (row.some(c => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) break;
      const vehicleNo = String(row[vehCol] || "").trim();
      if (!vehicleNo || vehicleNo.toLowerCase() === "vehicle no" || vehicleNo.toLowerCase().includes("running")) continue;
      const key = stripCode(vehicleNo);
      if (key) abcVehicles.add(key);
    }
  }

  console.log(`Daily running vehicles (CEP-03):`, Array.from(dailyVehicles));
  console.log(`ABC Package vehicles (CEP-03-ABC):`, Array.from(abcVehicles));

  const intersection = Array.from(abcVehicles).filter(x => dailyVehicles.has(x));
  console.log(`Overlap vehicles:`, intersection);
}

main();
