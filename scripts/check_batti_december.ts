import XLSX from "xlsx";
import path from "path";

const UPLOADS = "temp-uploads";
const FILE = "165a019a-Batti_ICDP_LOT03_December_2025.xlsx";

async function main() {
  const wb = XLSX.readFile(path.join(UPLOADS, FILE));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  console.log(`VEHICLES IN BATTI DECEMBER 2025 (Total ${raw.length} rows):`);
  for (let i = 3; i < raw.length; i++) {
    const r = raw[i];
    if (r && r[1]) {
      console.log(`Row ${i}: Vehicle = ${r[1]}, Type = ${r[2]}, Days = ${r[3]}, Fuel = ${r[6]}`);
    }
  }
}

main().catch(console.error);
