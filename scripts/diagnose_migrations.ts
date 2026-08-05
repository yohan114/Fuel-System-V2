import { prisma } from "../src/lib/db";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

// Work out why `prisma migrate deploy` fails on a database whose tables already
// exist, and print the exact commands to fix it. READ-ONLY — changes nothing.
//
// A database built with `prisma db push`, or restored from one that was, ends up
// with the full schema but an empty migration history. `migrate deploy` then
// replays migration 1 onward and dies on the first CREATE TABLE for something
// already there ("table X already exists"), which is a bookkeeping mismatch
// rather than damage: the schema is fine, Prisma just does not know it.
//
// The cure is `migrate resolve --applied <name>` for every migration whose
// objects are already present. Guessing one at a time means one failed deploy per
// migration, so this checks all of them up front: for each unapplied migration it
// parses the SQL for the tables, columns and indexes it would create and asks the
// database whether they exist already.
//
// With --apply it also performs the fix: backs the database up, marks the
// already-satisfied migrations as applied, then runs the remaining ones. It
// refuses outright if any migration is partially applied, because marking one of
// those applied would skip real schema work and the damage would surface later
// as a missing column rather than an error now.
//
//   npx tsx scripts/diagnose_migrations.ts            # read-only
//   npx tsx scripts/diagnose_migrations.ts --apply

const APPLY = process.argv.includes("--apply");

function announceDatabase(): string {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const file = url.replace(/^file:/, "").replace(/^\/{2,}/, "/");
  const abs = path.resolve(process.cwd(), file);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  return abs;
}

type Want = { tables: string[]; columns: [string, string][]; indexes: string[] };

// Only the object-creating statements matter — those are what collide.
function parse(sql: string): Want {
  const strip = sql.replace(/--[^\n]*\n/g, "\n");
  const tables = [...strip.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][\w]*)"?/gi)]
    .map((m) => m[1]).filter((t) => !/^_prisma/.test(t) && !/^new_/i.test(t));
  const columns = [...strip.matchAll(/ALTER TABLE\s+"?([A-Za-z_][\w]*)"?\s+ADD COLUMN\s+"?([A-Za-z_][\w]*)"?/gi)]
    .map((m) => [m[1], m[2]] as [string, string]);
  const indexes = [...strip.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][\w.]*)"?/gi)]
    .map((m) => m[1]);
  return { tables, columns, indexes };
}

async function main() {
  console.log(`\n=== Migration diagnosis (${APPLY ? "APPLY" : "read-only"}) ===`);
  const dbPath = announceDatabase();
  if (!fs.existsSync(dbPath)) throw new Error(`database not found at ${dbPath}`);

  const n = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);

  // history table may not exist at all on a db push database
  let history: { name: string; finished: boolean }[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`);
    history = rows.map((r) => ({ name: r.migration_name, finished: !!r.finished_at && !r.rolled_back_at }));
  } catch {
    console.log(`  _prisma_migrations table absent — this database has no migration history at all\n`);
  }
  const applied = new Set(history.filter((h) => h.finished).map((h) => h.name));
  // A migration can have both a failed attempt and a later successful one; only
  // an attempt with no successful record still blocks `migrate deploy`.
  const failed = history.filter((h) => !h.finished && !applied.has(h.name)).map((h) => h.name);

  const objs = await prisma.$queryRawUnsafe<any[]>(`SELECT type, name FROM sqlite_master`);
  const haveTable = new Set(objs.filter((o) => o.type === "table").map((o) => o.name));
  const haveIndex = new Set(objs.filter((o) => o.type === "index").map((o) => o.name));
  const colCache = new Map<string, Set<string>>();
  const haveColumn = async (t: string, c: string) => {
    if (!haveTable.has(t)) return false;
    if (!colCache.has(t)) {
      const info = await prisma.$queryRawUnsafe<any[]>(`PRAGMA table_info("${t}")`);
      colCache.set(t, new Set(info.map((i) => i.name)));
    }
    return colCache.get(t)!.has(c);
  };

  const dir = path.join(process.cwd(), "prisma/migrations");
  const names = fs.readdirSync(dir).filter((f) => fs.existsSync(path.join(dir, f, "migration.sql"))).sort();

  console.log(`  migrations on disk: ${names.length} · recorded applied: ${applied.size}` +
    (failed.length ? ` · FAILED/incomplete: ${failed.join(", ")}` : ""));
  console.log(`  tables in database: ${haveTable.size}\n`);

  const resolveAsApplied: string[] = [];
  const mustRun: string[] = [];
  const partial: string[] = [];

  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    const w = parse(sql);
    let present = 0, missing = 0;
    const detail: string[] = [];
    for (const t of w.tables) { if (haveTable.has(t)) present++; else { missing++; detail.push(`table ${t}`); } }
    for (const [t, c] of w.columns) { if (await haveColumn(t, c)) present++; else { missing++; detail.push(`${t}.${c}`); } }
    for (const i of w.indexes) { if (haveIndex.has(i)) present++; else { missing++; detail.push(`index ${i}`); } }

    if (present > 0 && missing === 0) { resolveAsApplied.push(name); console.log(`  ALREADY THERE  ${name}  (${present} objects present)`); }
    else if (present === 0 && missing > 0) { mustRun.push(name); console.log(`  NEEDS RUNNING  ${name}  (${missing} objects absent)`); }
    else if (present === 0 && missing === 0) { resolveAsApplied.push(name); console.log(`  NO-OP          ${name}  (data-only / nothing to create)`); }
    else { partial.push(name); console.log(`  PARTIAL        ${name}  — ${present} present, ${missing} missing: ${detail.slice(0, 4).join(", ")}`); }
  }

  console.log(`\n=== WHAT TO DO ===`);
  if (!resolveAsApplied.length && !mustRun.length && !partial.length) {
    console.log(`  Nothing pending — migration history matches the schema.\n`);
    await prisma.$disconnect(); return;
  }
  if (resolveAsApplied.length) {
    console.log(`\n  1. Mark these ${resolveAsApplied.length} as applied — their objects already exist, so`);
    console.log(`     running them would only produce "already exists" errors:\n`);
    for (const m of resolveAsApplied) console.log(`     npx prisma migrate resolve --applied ${m}`);
  }
  if (mustRun.length) {
    console.log(`\n  2. Then let the genuinely-new ones run:\n`);
    console.log(`     npx prisma migrate deploy        # will apply: ${mustRun.join(", ")}`);
  }
  if (partial.length) {
    console.log(`\n  ⚠ ${partial.length} migration(s) are PARTIALLY applied — some objects exist, some do not.`);
    console.log(`     Do not resolve these blindly; they need a look first: ${partial.join(", ")}`);
  }
  if (!APPLY) {
    console.log(`\n  Prefix each command with the live database, e.g.`);
    console.log(`     DATABASE_URL="file:${dbPath}" npx prisma migrate resolve --applied <name>`);
    console.log(`\n  Or let this script do all of it:  npx tsx scripts/diagnose_migrations.ts --apply\n`);
    await prisma.$disconnect(); return;
  }

  // ------------------------------------------------------------------- apply
  if (partial.length) {
    console.log(`\n  REFUSING to apply: ${partial.length} migration(s) are only partly present.`);
    console.log(`  Marking those applied would silently skip the schema changes they still owe,`);
    console.log(`  which surfaces much later as a missing column. Resolve them by hand first.\n`);
    await prisma.$disconnect(); process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${dbPath}.pre-migrate-${stamp}`;
  fs.copyFileSync(dbPath, backup);
  for (const side of ["-wal", "-shm"]) {
    if (fs.existsSync(dbPath + side)) fs.copyFileSync(dbPath + side, backup + side);
  }
  console.log(`\n  backed up to ${backup}`);

  // The Prisma CLI reads DATABASE_URL, not our FUEL_ variable.
  const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };
  const run = (args: string[]) =>
    execFileSync("npx", ["prisma", ...args], { env, stdio: "pipe" }).toString();

  await prisma.$disconnect();   // release the file before the CLI writes to it

  let done = 0;
  for (const m of resolveAsApplied) {
    try { run(["migrate", "resolve", "--applied", m]); done++; console.log(`  resolved  ${m}`); }
    catch (e: any) {
      console.log(`  FAILED    ${m}`);
      console.log(String(e.stdout || "") + String(e.stderr || ""));
      console.log(`\n  Stopped after ${done}. Database restored from backup is available at ${backup}\n`);
      process.exit(1);
    }
  }
  console.log(`  ${done} migration(s) marked applied`);

  if (mustRun.length) {
    console.log(`\n  applying the ${mustRun.length} genuinely-new migration(s)...`);
    try { console.log(run(["migrate", "deploy"])); }
    catch (e: any) {
      console.log(String(e.stdout || "") + String(e.stderr || ""));
      console.log(`\n  deploy failed. Restore with:  cp "${backup}" "${dbPath}"\n`);
      process.exit(1);
    }
  } else {
    console.log(`\n  verifying...`);
    console.log(run(["migrate", "status"]));
  }
  console.log(`\n  Done. Backup kept at ${backup}\n`);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
