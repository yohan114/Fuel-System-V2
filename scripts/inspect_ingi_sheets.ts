import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const FILE = path.join(process.cwd(), "Inginimitiya Vehicle, Machinery summary.xlsx");

function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Inginimitiya file not found!");
    return;
  }
  const wb = XLSX.readFile(FILE, { cellDates: false });
  console.log("Sheet Names in Inginimitiya Vehicle, Machinery summary.xlsx:");
  console.log(wb.SheetNames);

  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    console.log(`\nSheet: "${sn}" | Rows: ${rows.length}`);
    if (rows.length > 3) {
      console.log("  Row 0:", rows[0].slice(0, 10));
      console.log("  Row 2 (Header):", rows[2].slice(0, 10));
      console.log("  Row 3 (First Data):", rows[3].slice(0, 10));
    }
  }
}

main();
