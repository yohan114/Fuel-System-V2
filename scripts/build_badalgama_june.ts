import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";
import * as XLSX from "xlsx";

// Build Badalgama-yard June 2026 DRY bills, split into 3 sub-sites from the
// Combined Site-Wise Register's "Original Site Label":
//   BADALGAMA            -> project "Badalgama"        (BDL, created if missing)
//   BADALGAMA PLANT      -> project "Badalgama Plant"  (BADAL)
//   BADALGAMA WORKSHOP   -> project "Badalgama Workshop" (BADAL-WS)  (+ AUTO BACS)
// Vehicles already carrying a finalized (ISSUED) June bill elsewhere (e.g. DC-08
// on Galagedara) are auto-skipped by the generator and excluded here.
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");   // Jun 1 Colombo 00:00
const JE = new Date("2026-06-30T18:29:59.999Z");   // Jun 30 Colombo 23:59
const REG = "/root/.claude/uploads/ddd640e9-2dc1-5d1a-9875-08410003a7a4/f69bb513-Combined_Site_Wise_Register.xlsx";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

function subSite(o: string): string | null {
  const u = o.trim().toUpperCase();
  if (u === "BADALGAMA") return "Badalgama";
  if (u === "BADALGAMA PLANT") return "Badalgama Plant";
  if (u === "BADALGAMA WORKSHOP" || u === "AUTO BACS") return "Badalgama Workshop";
  return null;
}

async function main() {
  const wb = XLSX.readFile(REG);
  const reg = XLSX.utils.sheet_to_json(wb.Sheets["Combined Register"], { header: 1, defval: "" }) as any[][];
  const rows = reg.slice(4).filter(r => String(r[0]).trim() !== "" && /badal/i.test(String(r[0])) && String(r[1]).trim().toLowerCase() === "vehicle");

  // Resolve the 3 sub-site projects (create plain Badalgama if needed)
  let bdl = await prisma.project.findFirst({ where: { name: "Badalgama" } });
  if (!bdl) {
    if (APPLY) {
      bdl = await prisma.project.create({ data: { name: "Badalgama", code: "BDL" } });
      console.log(`Created project "Badalgama" (BDL) id=${bdl.id}`);
    } else console.log(`[dry] would create project "Badalgama" (BDL)`);
  }
  const plant = await prisma.project.findUnique({ where: { code: "BADAL" } });
  const ws = await prisma.project.findUnique({ where: { code: "BADAL-WS" } });
  if (!plant || !ws) throw new Error("BADAL / BADAL-WS project missing");
  const projFor: Record<string, { id: string; code: string } | null> = {
    "Badalgama": bdl ? { id: bdl.id, code: "BDL" } : null,
    "Badalgama Plant": { id: plant.id, code: "BADAL" },
    "Badalgama Workshop": { id: ws.id, code: "BADAL-WS" },
  };

  const perSite: Record<string, string[]> = { "Badalgama": [], "Badalgama Plant": [], "Badalgama Workshop": [] };
  const skips: string[] = [];
  const allIds: string[] = [];

  for (const r of rows) {
    const ss = subSite(String(r[6]));
    const code = String(r[2]).trim();
    if (!ss || !code || code === "-") continue;
    const a = await prisma.asset.findUnique({ where: { code }, include: { rentalRate: true } });
    if (!a) { skips.push(`${code} (not in system)`); continue; }
    if (!a.rentalRate) { skips.push(`${code} (no rate)`); continue; }
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: Y, month: M } } });
    if (jb && jb.status !== "DRAFT") { skips.push(`${code} (locked @${jb.projectCode})`); continue; }
    const tgt = projFor[ss]!;
    if (APPLY) {
      // Clear June-only postings (replaced by Badalgama); leave multi-month spans
      // (Badalgama wins June via latest-startDate, other months preserved).
      await prisma.assetAssignment.deleteMany({
        where: { assetId: a.id, startDate: { gte: JS }, endDate: { not: null, lte: JE } },
      });
      await prisma.assetAssignment.create({
        data: { assetId: a.id, projectId: tgt.id, startDate: JS, endDate: JE, billingType: "DRY" },
      });
      allIds.push(a.id);
    }
    perSite[ss].push(code);
  }

  console.log(`\nBadalgama June DRY build (${APPLY ? "APPLY" : "dry-run"})`);
  for (const ss of Object.keys(perSite)) console.log(`   ${ss}: ${perSite[ss].length} vehicles`);
  console.log(`   skipped: ${skips.length} -> ${skips.join(", ")}`);
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: allIds, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, no-rate ${res.noRate}, skipped-finalized ${res.skippedFinalized ?? 0}, skipped-not-here ${res.skippedNotHere ?? 0}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);

  let grand = 0;
  for (const code of ["BDL", "BADAL", "BADAL-WS"]) {
    const bills = await prisma.bill.findMany({ where: { projectCode: code, year: Y, month: M }, orderBy: { grandTotalCents: "desc" } });
    const sub = bills.reduce((s, b) => s + b.grandTotalCents, 0); grand += sub;
    console.log(`\n=== ${code} — ${bills.length} bills — ${rs(sub)} ===`);
    for (const b of bills) console.log(`  ${b.assetCode.padEnd(9)} ${(b.billingMode||"").padEnd(7)} bill=${String(b.billableUnits).padStart(5)} grand ${rs(b.grandTotalCents).padStart(13)}`);
  }
  console.log(`\nBADALGAMA YARD JUNE TOTAL (3 sub-sites): ${rs(grand)}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
