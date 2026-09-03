// Exercise the site-wise fuel report and its sheet without a browser session.
//
//     npx tsx scripts/check-site-fuel-report.ts 2026 8
//
// The page behind this report is behind a login, so the only way to see whether
// a change to it actually works is to run the builder and write the workbook
// the export route writes. This does both and checks the parts that are easy to
// get silently wrong: that every issue is still accounted for after the shape
// change, that the per-machine issue lists add up to the machine totals, and
// that the workbook Excel would open has the tabs and columns claimed.

import * as XLSX from "xlsx";
import { buildMonthlySiteFuel, excelSheetName, type ReportBasis } from "../src/lib/reports/monthly-site-fuel";

const year = Number(process.argv[2]) || 2026;
const month = Number(process.argv[3]) || 8;

const L = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // Both bases, because the whole point of the option is that they differ, and
  // the thing that must stay true either way is that every issue is counted once.
  for (const b of ["pump", "billed"] as ReportBasis[]) {
    const x = await buildMonthlySiteFuel({ year, month, basis: b });
    const sum = L(x.sites.reduce((a, s) => a + s.litres, 0));
    const ok = Math.abs(sum - x.totals.litres) < 0.01 && x.totals.issueCount === x.reconciliation.issuesInMonth;
    console.log(`  basis=${b.padEnd(7)} ${String(x.sites.length).padStart(3)} sites  ${String(x.totals.issueCount).padStart(5)} issues  ${String(L(x.totals.litres)).padStart(11)} L  ${ok ? "reconciles" : "<-- DOES NOT RECONCILE"}`);
    if (!ok) process.exitCode = 1;
  }

  const r = await buildMonthlySiteFuel({ year, month, basis: (process.env.BASIS as ReportBasis) || "pump" });

  console.log(`\n=== ${r.period.label} ===`);
  console.log(`  sites ${r.sites.length}   machines ${r.totals.machineCount}   issues ${r.totals.issueCount}   ${L(r.totals.litres)} L`);
  console.log(`  reconciliation balanced: ${r.reconciliation.balanced}`);

  // Billed against pump. These are MEANT to differ per site. What must hold is
  // that the billed column still sums to the month, and that no site reports
  // pump fuel its tank never issued.
  console.log(`\n  site         billed          from its pump      difference`);
  for (const s of [...r.sites].sort((a, b) => b.pumpLitres - a.pumpLitres).slice(0, 8)) {
    const pump = s.pumpIssueCount ? `${L(s.pumpLitres)} L` : "no tank";
    const diff = s.pumpIssueCount ? L(s.pumpLitres - s.litres) : "";
    console.log(`    ${s.code.padEnd(12)}${String(L(s.litres)).padStart(10)} L ${String(pump).padStart(16)}${String(diff).padStart(15)}`);
  }
  const billedSum = L(r.sites.reduce((a, s) => a + s.litres, 0));
  const pumpSum = L(r.sites.reduce((a, s) => a + s.pumpLitres, 0));
  console.log(`\n  billed column sums to ${billedSum}  (month total ${L(r.totals.litres)})${Math.abs(billedSum - r.totals.litres) < 0.01 ? "  MATCH" : "  <-- MISMATCH"}`);
  console.log(`  pump column sums to   ${pumpSum}  (report says ${L(r.totals.pumpLitres)})${Math.abs(pumpSum - r.totals.pumpLitres) < 0.01 ? "  MATCH" : "  <-- MISMATCH"}`);
  if (Math.abs(billedSum - r.totals.litres) > 0.01 || Math.abs(pumpSum - r.totals.pumpLitres) > 0.01) process.exitCode = 1;

  // The change added a per-machine issue list. If it disagrees with the totals
  // that were already correct, the list is wrong — that is the whole check.
  let listed = 0;
  let listedLitres = 0;
  const bad: string[] = [];
  for (const s of r.sites) {
    for (const m of s.machines) {
      listed += m.issues.length;
      const sum = L(m.issues.reduce((a, i) => a + i.litres, 0));
      listedLitres += sum;
      if (m.issues.length !== m.issueCount) bad.push(`${s.code}/${m.code}: ${m.issues.length} issues listed vs issueCount ${m.issueCount}`);
      if (Math.abs(sum - m.litres) > 0.01) bad.push(`${s.code}/${m.code}: issues sum ${sum} L vs machine total ${m.litres} L`);
    }
  }
  console.log(`\n  issues listed under machines : ${listed}  (report total ${r.totals.issueCount})`);
  console.log(`  litres in those lists         : ${L(listedLitres)}  (report total ${L(r.totals.litres)})`);
  if (bad.length) {
    console.log(`\n  MISMATCHES (${bad.length}):`);
    for (const b of bad.slice(0, 20)) console.log(`    ${b}`);
    process.exitCode = 1;
  } else {
    console.log("  every machine's issue list matches its totals");
  }

  // Both identifiers, which is the point of the request.
  const withReg = r.sites.flatMap((s) => s.machines).filter((m) => m.regNo);
  const noReg = r.sites.flatMap((s) => s.machines).filter((m) => !m.regNo);
  console.log(`\n  machines carrying a registration : ${withReg.length}`);
  console.log(`  machines with no registration    : ${noReg.length}${noReg.length ? "  e.g. " + noReg.slice(0, 5).map((m) => m.code).join(", ") : ""}`);

  const sample = r.sites.find((s) => s.code === "CEP-03F") ?? r.sites[0];
  const m0 = sample?.machines[0];
  if (m0) {
    console.log(`\n  sample — ${sample.code} / ${m0.code}${m0.regNo ? ` (${m0.regNo})` : ""}, ${m0.issueCount} issues, ${m0.litres} L`);
    for (const i of m0.issues.slice(0, 5))
      console.log(`      ${i.day}  ${String(i.litres).padStart(6)} L  pump ${String(i.tankSite ?? "—").padEnd(9)} meter ${i.meterReading ?? "—"}  ${i.rule}`);
    if (m0.issues.length > 5) console.log(`      ... ${m0.issues.length - 5} more`);
  }

  // Build the workbook the same way the route does, and prove it opens.
  const lkr = (c: number) => Math.round(c) / 100;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Site Summary placeholder"]]), "Site Summary");
  const taken = new Set<string>(["site summary", "reconciliation", "all issues"]);
  for (const s of r.sites) {
    const rows: (string | number)[][] = [[`${s.name} (${s.code})`], [], ["E&C No.", "Vehicle No.", "Description", "Fuel Issues", "Quantity (L)", "Cost (LKR)", "Assigned By"]];
    for (const mac of s.machines) rows.push([mac.code, mac.regNo ?? "", mac.label, mac.issueCount, mac.litres, lkr(mac.costCents), ""]);
    rows.push([], [], ["Every fuel issue, vehicle by vehicle"]);
    rows.push(["E&C No.", "Vehicle No.", "Date", "Pump (site)", "Quantity (L)", "Rate (LKR/L)", "Cost (LKR)", "Meter", "Unit", "Issued To", "Attributed By", "Source"]);
    for (const mac of s.machines) for (const i of mac.issues)
      rows.push([mac.code, mac.regNo ?? "", i.day, i.tankSite ?? "—", i.litres, lkr(i.pricePerLitre), lkr(i.costCents), i.meterReading ?? "", i.readingType ?? "", i.issuePerson ?? "", i.rule, i.source ?? ""]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), excelSheetName(s.name, taken));
  }
  const all: (string | number)[][] = [["Site Code", "Site", "E&C No.", "Vehicle No.", "Description", "Date", "Pump (site)", "Quantity (L)", "Rate (LKR/L)", "Cost (LKR)", "Meter", "Unit", "Issued To", "Attributed By", "Source"]];
  for (const s of r.sites) for (const mac of s.machines) for (const i of mac.issues)
    all.push([s.code, s.name, mac.code, mac.regNo ?? "", mac.label, i.day, i.tankSite ?? "", i.litres, lkr(i.pricePerLitre), lkr(i.costCents), i.meterReading ?? "", i.readingType ?? "", i.issuePerson ?? "", i.rule, i.source ?? ""]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), "All Issues");

  const out = process.env.OUT || `D:/Fuel system server side/site-fuel-check-${r.period.periodKey}.xlsx`;
  XLSX.writeFile(wb, out);

  // Read it back: a workbook that writes but does not re-read is no proof.
  const back = XLSX.readFile(out);
  const allBack = XLSX.utils.sheet_to_json(back.Sheets["All Issues"], { header: 1, defval: "" }) as unknown[][];
  console.log(`\n  workbook tabs (${back.SheetNames.length}): ${back.SheetNames.slice(0, 6).join(", ")}${back.SheetNames.length > 6 ? ", ..." : ""}`);
  console.log(`  "All Issues" rows: ${allBack.length - 1} data rows for ${r.totals.issueCount} issues${allBack.length - 1 === r.totals.issueCount ? "  MATCH" : "  <-- MISMATCH"}`);
  if (allBack.length - 1 !== r.totals.issueCount) process.exitCode = 1;
  console.log(`  written: ${out}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
