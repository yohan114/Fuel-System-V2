import XLSX from "xlsx";
import path from "path";

const UPLOADS = "temp-uploads";
const FILE = "56342016-01_January_2026.xlsb";

async function main() {
  const wb = XLSX.readFile(path.join(UPLOADS, FILE));
  console.log("TOTALS ROW FOR ALL SHEETS IN JAN 2026:");
  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) continue;
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
    const totalsRow = raw.find(r => r && typeof r[0] === "string" && r[0].trim().toLowerCase().startsWith("totals"));
    if (totalsRow) {
      console.log(`Sheet: ${sheetName} -> Totals:`, JSON.stringify(totalsRow));
    } else {
      console.log(`Sheet: ${sheetName} -> No Totals row found`);
    }
  }
}

main().catch(console.error);
