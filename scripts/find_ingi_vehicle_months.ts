import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILE = path.join(process.cwd(), "Inginimitiya Vehicle, Machinery summary.xlsx");

function main() {
  if (!fs.existsSync(FILE)) return;
  const wb = XLSX.readFile(FILE, { cellDates: false });
  
  const vehMonths: Record<string, string[]> = {};

  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (rows.length < 3) continue;
    
    // Header is row 2
    const header = rows[2] || [];
    const vehIdx = header.findIndex(c => typeof c === "string" && c.toLowerCase().includes("vehicle no"));
    if (vehIdx < 0) continue;

    for (const row of rows.slice(3)) {
      const r = row as unknown[];
      if (r.some(c => typeof c === "string" && (c.toLowerCase().includes("external vehicle") || c.toLowerCase().trim() === "external"))) {
        break;
      }
      const rawCode = String(r[vehIdx] || "").trim();
      if (!rawCode || !/^[A-Z0-9-]+$/i.test(rawCode) || rawCode.toLowerCase().includes("running") || rawCode.toLowerCase() === "vehicle no") {
        continue;
      }
      if (!vehMonths[rawCode]) vehMonths[rawCode] = [];
      vehMonths[rawCode].push(sn);
    }
  }

  console.log("Inginimitiya Sheet Vehicle Occurrences:");
  for (const [veh, months] of Object.entries(vehMonths)) {
    console.log(`  - ${veh}: ${months.join(", ")}`);
  }
}

main();
