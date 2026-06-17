import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const UPLOADS = "temp-uploads";
const FILES = [
  "dd9fd7f5-Batti_ICDP_LOT03_January.xlsx",
  "71a0583e-Batti_ICDP_LOT03_September_2025.xlsx",
  "7cd63ca6-Batti_ICDP_LOT03_October_2025.xlsx",
  "b7247401-Batti_ICDP_LOT03_November_2025.xlsx",
  "165a019a-Batti_ICDP_LOT03_December_2025.xlsx",
];

async function main() {
  for (const file of FILES) {
    const filePath = path.join(UPLOADS, file);
    if (!fs.existsSync(filePath)) {
      console.log(`File missing: ${file}`);
      continue;
    }
    const wb = XLSX.readFile(filePath);
    console.log(`\n========================================`);
    console.log(`File: ${file}`);
    console.log(`Sheets:`, wb.SheetNames);
    
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      console.log(`Sheet "${sheetName}" has ${raw.length} rows`);
      
      // Let's print rows 0 to 5 to inspect headers/metadata
      for (let i = 0; i < Math.min(6, raw.length); i++) {
        console.log(`  Row ${i}:`, JSON.stringify(raw[i]));
      }

      // Print first 5 vehicle rows (which start at row index 3 usually)
      console.log(`  Sample data rows:`);
      let printed = 0;
      for (let i = 3; i < raw.length; i++) {
        const r = raw[i];
        if (r && r.join("").trim() !== "") {
          console.log(`    Row ${i}:`, JSON.stringify(r));
          printed++;
          if (printed >= 5) break;
        }
      }
    }
  }
}

main().catch(console.error);
