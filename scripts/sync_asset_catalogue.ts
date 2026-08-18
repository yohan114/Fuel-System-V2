import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Carry the whole fleet list from one instance to another.
//
// The fuel export deliberately carries only the machines its rows mention — 493
// of 749 here — and only the handful of fields a fuel row needs: code, plate,
// meter type, category, site. Everything the fleet directory shows about a
// machine, its brand, model, capacity, year, chassis, engine and serial number,
// never travels. A server fed by the fuel sync alone therefore has a fleet made
// entirely of machines that happen to have drawn fuel, each with almost nothing
// against it.
//
// This is the catalogue instead: every machine, every descriptive field.
//
// It is additive and non-destructive by design. Machines the far side has and
// this file does not are LEFT ALONE — a server carries units this workstation has
// never seen, and a catalogue sync is not the place to decide they should go. An
// empty field never blanks a value that is already there, for the same reason a
// register does not: absent means "not recorded here", not "delete it".
//
// Codes are never changed. Two records for one machine is a merge and
// merge_assets.ts is the tool; a plate arriving on a machine that is not the one
// already holding it is reported rather than written, because that is how a
// duplicate is created rather than resolved.
//
//   npx tsx scripts/sync_asset_catalogue.ts --out=data/asset-catalogue.json
//   npx tsx scripts/sync_asset_catalogue.ts --in=data/asset-catalogue.json
//   npx tsx scripts/sync_asset_catalogue.ts --in=data/asset-catalogue.json --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = arg("out");
const IN = arg("in");

const FIELDS = ["brand", "typeLabel", "model", "regNo", "capacity", "yom",
  "chassisNo", "engineNo", "serialNo", "site"] as const;

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
}

async function exportAll() {
  console.log(`\n=== export the fleet catalogue ===`);
  announceDatabase();
  const assets = await prisma.asset.findMany({
    include: { category: { select: { code: true, name: true } }, project: { select: { code: true } } },
    orderBy: { code: "asc" },
  });
  const payload = {
    kind: "asset-catalogue",
    version: 1,
    exportedAt: new Date().toISOString(),
    count: assets.length,
    assets: assets.map((a) => ({
      code: a.code,
      categoryCode: a.category?.code ?? null,
      categoryName: a.category?.name ?? null,
      projectCode: a.project?.code ?? null,
      meterType: a.meterType,
      status: a.status,
      ownership: a.ownership,
      dailyCapLitres: a.dailyCapLitres,
      ...Object.fromEntries(FIELDS.map((f) => [f, (a as Record<string, unknown>)[f] ?? null])),
    })),
  };
  const dest = path.resolve(process.cwd(), OUT!);
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2));
  // Counted off the database rows, where the fields are typed; the payload
  // widens them away through the spread.
  const withDetail = assets.filter((a) => a.brand || a.model || a.serialNo).length;
  console.log(`\n  ${assets.length} machines · ${withDetail} carry brand, model or serial`);
  console.log(`  wrote ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)\n`);
}

async function importAll() {
  console.log(`\n=== load the fleet catalogue (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();
  const file = path.resolve(process.cwd(), IN!);
  if (!fs.existsSync(file)) throw new Error(`not found: ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (payload.kind !== "asset-catalogue") throw new Error(`not an asset catalogue: ${file}`);
  console.log(`  ${file} · exported ${payload.exportedAt} · ${payload.assets.length} machines\n`);

  const cats = await prisma.category.findMany({ select: { id: true, code: true, name: true } });
  const catByCode = new Map(cats.map((c) => [c.code.toUpperCase(), c]));
  const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
  const projs = await prisma.project.findMany({ select: { id: true, code: true } });
  const projByCode = new Map(projs.map((p) => [p.code, p]));
  const here = new Map((await prisma.asset.findMany()).map((a) => [a.code, a]));
  // A plate can already be on several machines here — that is the duplication
  // being cleaned up elsewhere. Keep every holder, so a machine is only reported
  // as clashing when the plate belongs to someone OTHER than itself.
  const plateOwners = new Map<string, Set<string>>();
  for (const [, a] of here) {
    if (!a.regNo) continue;
    const k = a.regNo.replace(/[^a-z0-9]/gi, "").toUpperCase();
    (plateOwners.get(k) ?? plateOwners.set(k, new Set()).get(k)!).add(a.code);
  }

  let created = 0, updated = 0, same = 0, noCategory = 0, plateClash = 0;
  const createdCodes: string[] = [], clashes: string[] = [], missingCats = new Set<string>();
  const changed: string[] = [];

  for (const a of payload.assets as Record<string, any>[]) {
    const mine = here.get(a.code);

    // The plate must not land on a machine that is not the one already holding
    // it — that is how a duplicate gets made rather than resolved.
    if (a.regNo) {
      const key = String(a.regNo).replace(/[^a-z0-9]/gi, "").toUpperCase();
      const owners = plateOwners.get(key);
      if (owners && !owners.has(a.code)) {
        clashes.push(`${a.code}: plate ${a.regNo} already belongs to ${[...owners].join(", ")} here — merge them, do not copy the plate`);
        plateClash++;
        continue;
      }
    }

    const wanted: Record<string, unknown> = {};
    for (const f of FIELDS) if (a[f] !== null && a[f] !== undefined && a[f] !== "") wanted[f] = a[f];

    if (!mine) {
      const cat = (a.categoryCode && catByCode.get(String(a.categoryCode).toUpperCase()))
        || (a.categoryName && catByName.get(String(a.categoryName).trim().toLowerCase()));
      if (!cat) { missingCats.add(`${a.categoryCode ?? "—"} / ${a.categoryName ?? "—"}`); noCategory++; continue; }
      created++;
      createdCodes.push(`${a.code} (${cat.name}${a.regNo ? `, ${a.regNo}` : ""})`);
      if (APPLY) await prisma.asset.create({ data: {
        code: a.code, categoryId: cat.id,
        projectId: a.projectCode ? projByCode.get(a.projectCode)?.id ?? null : null,
        meterType: a.meterType || "HOURS",
        status: a.status || "ACTIVE",
        ownership: a.ownership || "OWNED",
        dailyCapLitres: a.dailyCapLitres ?? null,
        ...wanted } as never });
      continue;
    }

    const diffs: string[] = [];
    for (const [k, v] of Object.entries(wanted)) {
      const now = (mine as Record<string, unknown>)[k];
      if (String(now ?? "") === String(v)) continue;
      diffs.push(`${k}: ${now === null || now === "" ? "—" : now} -> ${v}`);
    }
    if (!diffs.length) { same++; continue; }
    updated++;
    changed.push(`${a.code}  ${diffs.join(" · ")}`);
    if (APPLY) await prisma.asset.update({ where: { id: mine.id }, data: wanted as never });
  }

  if (createdCodes.length) {
    console.log(`  ${APPLY ? "created" : "to create"} (${createdCodes.length}):`);
    for (const c of createdCodes.slice(0, 40)) console.log(`      ${c}`);
    if (createdCodes.length > 40) console.log(`      … and ${createdCodes.length - 40} more`);
  }
  if (changed.length) {
    console.log(`\n  ${APPLY ? "updated" : "to update"} (${changed.length}):`);
    for (const c of changed.slice(0, 30)) console.log(`      ${c}`);
    if (changed.length > 30) console.log(`      … and ${changed.length - 30} more`);
  }
  if (clashes.length) {
    console.log(`\n  SKIPPED — the plate belongs to another machine here (${clashes.length}):`);
    for (const c of clashes.slice(0, 20)) console.log(`      ${c}`);
    if (clashes.length > 20) console.log(`      … and ${clashes.length - 20} more`);
    console.log(`      run  npx tsx scripts/merge_assets.ts --all-certain  first`);
  }
  if (missingCats.size) {
    console.log(`\n  SKIPPED — no matching category here (${noCategory} machine(s)):`);
    for (const c of missingCats) console.log(`      ${c}`);
  }

  const extra = [...here.keys()].filter((c) => !payload.assets.some((a: { code: string }) => a.code === c));
  console.log(`\n  ${created} created · ${updated} updated · ${same} already matched` +
    `${plateClash ? ` · ${plateClash} skipped on a plate clash` : ""}${noCategory ? ` · ${noCategory} skipped with no category` : ""}`);
  console.log(`  ${extra.length} machine(s) exist here but not in the file — left untouched`);
  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

async function main() {
  if (OUT) return exportAll();
  if (IN) return importAll();
  throw new Error("need --out=<file> to export, or --in=<file> to load");
}

main().finally(() => prisma.$disconnect());
