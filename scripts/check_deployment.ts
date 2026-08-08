import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// What is actually ON this server?
//
// "The update did not work" has several very different causes — the deploy never
// ran, it ran against a different database, it stopped at a prompt before
// reaching the step you wanted, or it ran fine and the data was already there.
// Guessing between them by eye costs more than asking the database.
//
// Read-only. Safe to run on a live server at any time.
//
//   npx tsx scripts/check_deployment.ts
//   FUEL_DATABASE_URL="file:/var/lib/fuel-system/app.db" npx tsx scripts/check_deployment.ts

// Each import stamps its rows with a source string, so their presence is a
// direct answer to "did this step run", not an inference from totals.
const EXPECTED: { label: string; source: string; rows: number; litres: number }[] = [
  { label: "Galagedara monthly workbook", source: "Galagedara ", rows: 436, litres: 18403 },
  { label: "CEP-03 E July log book", source: "CEP-03 E fuel log book", rows: 89, litres: 2172 },
  { label: "CEP-03 E August register", source: "CEP-03 E daily fuel register", rows: 20, litres: 500 },
  { label: "CEP-03 W August register", source: "CEP-03 Wadakada fuel register", rows: 32, litres: 634 },
  { label: "Karaitivu stock book", source: "Karaitivu diesel stock book", rows: 360, litres: 13120 },
  { label: "Pallanoya stock book", source: "Pallanoya diesel stock book", rows: 26, litres: 1385 },
  { label: "Lot-02 August sheets", source: "Lot-02 daily fuel issuing sheet", rows: 60, litres: 835 },
];

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

async function main() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`\n=== deployment check ===`);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
  try {
    console.log(`  code    : ${execSync("git log --oneline -1", { encoding: "utf8" }).trim()}`);
    const behind = execSync("git rev-list --count HEAD..@{u} 2>/dev/null || echo 0", { encoding: "utf8", shell: "/bin/bash" }).trim();
    console.log(`  ${behind === "0" ? "up to date with its branch" : `BEHIND its branch by ${behind} commit(s) — the code on disk is old`}`);
  } catch { console.log("  code    : (not a git checkout)"); }

  // ---------------------------------------------------------- did each import land
  console.log(`\n--- imports ---`);
  for (const e of EXPECTED) {
    const rows = await prisma.fuelIssue.findMany({
      where: { voided: false, source: { startsWith: e.source } },
      select: { litres: true },
    });
    const l = rows.reduce((s, r) => s + r.litres, 0);
    // The expected counts come from the workstation copy. A server legitimately
    // holds rows that copy never had — operator entries made on the day — so MORE
    // than expected is not a fault and must not read like one. FEWER means rows
    // were skipped, usually because a vehicle was missing when the sync ran.
    const state = rows.length === 0 ? "MISSING — this step has not run"
      : rows.length === e.rows ? "complete"
      : rows.length > e.rows ? `complete, plus ${rows.length - e.rows} row(s) this server has and the workstation does not`
      : `SHORT by ${e.rows - rows.length} row(s) — rows were skipped, re-run the import`;
    console.log(`  ${e.label.padEnd(30)} ${String(rows.length).padStart(4)} rows ${String(Math.round(l)).padStart(7)} L   ${state}`);
  }

  const meters = await prisma.meterReading.count();
  console.log(`  ${"meter readings".padEnd(30)} ${String(meters).padStart(4)}          ${meters === 0 ? "  MISSING — the August register has not run" : "  present"}`);

  // ---------------------------------------------------------------- per pump
  console.log(`\n--- pumps, most recent fuel first ---`);
  const tanks = await prisma.bulkTank.findMany({ include: { project: { select: { code: true } } } });
  const lines: { name: string; site: string; n: number; l: number; last: string }[] = [];
  for (const t of tanks) {
    const rows = await prisma.fuelIssue.findMany({
      where: { bulkTankId: t.id, voided: false },
      select: { litres: true, issueDate: true },
      orderBy: { issueDate: "desc" },
    });
    if (!rows.length) continue;
    lines.push({
      name: t.name, site: t.project?.code ?? "—",
      n: rows.length, l: rows.reduce((s, r) => s + r.litres, 0),
      last: dayOf(rows[0].issueDate),
    });
  }
  for (const p of lines.sort((a, b) => b.last.localeCompare(a.last))) {
    console.log(`  ${p.last}  ${p.name.padEnd(34)} ${p.site.padEnd(11)} ${String(p.n).padStart(5)} issues ${Math.round(p.l).toLocaleString().padStart(9)} L`);
  }

  // ------------------------------------------------------------ CEP-03 E detail
  const proj = await prisma.project.findUnique({ where: { code: "CEP-03E" } });
  if (proj) {
    const tank = await prisma.bulkTank.findFirst({ where: { projectId: proj.id } });
    if (tank) {
      const rows = await prisma.fuelIssue.findMany({
        where: { bulkTankId: tank.id, voided: false }, select: { litres: true, issueDate: true } });
      const byMonth = new Map<string, { n: number; l: number }>();
      for (const r of rows) {
        const k = dayOf(r.issueDate).slice(0, 7);
        const e = byMonth.get(k) ?? { n: 0, l: 0 };
        e.n++; e.l += r.litres;
        byMonth.set(k, e);
      }
      console.log(`\n--- CEP-03 E, month by month (${rows.length} issues, balance ${tank.balance} L) ---`);
      for (const k of [...byMonth.keys()].sort()) {
        const e = byMonth.get(k)!;
        console.log(`  ${k}  ${String(e.n).padStart(5)} issues ${Math.round(e.l).toLocaleString().padStart(8)} L`);
      }
      if (!byMonth.has("2026-08")) console.log(`  2026-08  NOTHING — the August register has not reached this pump`);
    }
  }

  // ------------------------------------------------------- leftover duplicates
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const projects = await prisma.project.findMany({ select: { code: true, name: true } });
  const dupSites = projects.filter((a, i) => projects.some((b, j) => j !== i && (norm(a.code) === norm(b.code) || norm(a.name) === norm(b.name))));
  const allTanks = await prisma.bulkTank.findMany({ select: { name: true, projectId: true } });
  const dupTanks = allTanks.filter((a, i) => allTanks.some((b, j) => j !== i && a.projectId && a.projectId === b.projectId));
  console.log(`\n--- duplicates ---`);
  console.log(`  sites written two ways : ${dupSites.length ? dupSites.map((p) => p.code).join(", ") : "none"}`);
  console.log(`  sites with two pumps   : ${dupTanks.length ? dupTanks.map((t) => `"${t.name}"`).join(", ") : "none"}`);

  console.log("");
}

main().finally(() => prisma.$disconnect());
