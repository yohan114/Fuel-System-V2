import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const DAILY_FILE = path.join(process.cwd(), "temp-uploads", "56342016-01_January_2026.xlsb");
const SUMMARY_FILE = path.join(process.cwd(), "CEP-03 A,B and C - January 2026.xlsx");

const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };

function main() {
  console.log("=== COMPARING CEP DATA ===");

  if (!fs.existsSync(DAILY_FILE)) {
    console.error("Daily file not found!");
    return;
  }
  if (!fs.existsSync(SUMMARY_FILE)) {
    console.error("Summary file not found!");
    return;
  }

  // 1. Read Summary
  const wbSum = XLSX.readFile(SUMMARY_FILE, { cellDates: false });
  const rowSum = XLSX.utils.sheet_to_json<unknown[]>(wbSum.Sheets[wbSum.SheetNames[0]], { header: 1, defval: "" });
  
  // Find summary columns
  const headerRow = rowSum[2];
  const vehCol = headerRow.findIndex(c => String(c).toLowerCase().includes("vehicle no"));
  const unitsCol = headerRow.findIndex(c => String(c).toLowerCase().includes("actual days"));
  const fuelCol = headerRow.findIndex(c => String(c).toLowerCase() === "fuel");
  
  const summaries = new Map<string, { units: number; fuel: number }>();
  for (let r = 3; r < rowSum.length; r++) {
    const row = rowSum[r];
    if (!row || row.length === 0) continue;
    if (row.some(c => typeof c === "string" && c.toLowerCase().includes("external"))) break;
    const veh = String(row[vehCol] || "").trim().toUpperCase().replace(/[\s\-_]/g, "");
    if (!veh || veh.includes("RUNNING")) continue;
    
    summaries.set(veh, {
      units: toFloat(row[unitsCol]),
      fuel: toFloat(row[fuelCol])
    });
  }

  // 2. Read Daily XLSB
  const wbDaily = XLSX.readFile(DAILY_FILE, { cellDates: false });
  console.log(`Unique sheets in daily file: ${wbDaily.SheetNames.length}`);
  
  for (const sheetName of wbDaily.SheetNames) {
    if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) continue;
    const key = sheetName.toUpperCase().replace(/[\s\-_]/g, "");
    
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wbDaily.Sheets[sheetName], { header: 1, defval: "" });
    let totalFuel = 0;
    let totalHours = 0;
    let workingDays = 0;
    
    for (const row of rows.slice(11)) {
      const r = row as unknown[];
      if (!r[1]) continue; // Date column
      
      const litres = toFloat(r[11]);
      const hours = toFloat(r[9]);
      const distOrHrs = toFloat(r[6]);
      
      if (litres > 0) totalFuel += litres;
      if (hours > 0) totalHours += hours;
      
      const working = distOrHrs > 0 || hours > 0 || litres > 0;
      if (working) workingDays++;
    }
    
    const sumData = summaries.get(key);
    if (sumData) {
      console.log(`Vehicle: ${sheetName}`);
      console.log(`  Daily Sheet  -> Days Worked: ${workingDays}, Total Hours: ${totalHours}, Fuel: ${totalFuel} L`);
      console.log(`  Summary Sheet -> Units: ${sumData.units}, Fuel: ${sumData.fuel} L`);
      if (sumData.fuel === totalFuel && (sumData.units === totalHours || sumData.units === workingDays)) {
        console.log(`  >> MATCH!`);
      } else {
        console.log(`  >> MISMATCH!`);
      }
    }
  }
}

main();
