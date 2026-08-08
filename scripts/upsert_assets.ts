import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

// Fill in a machine's details from the fleet register.
//
// The fuel importers only ever learn a machine's code and plate — that is all a
// daily issue sheet carries. Brand, model, capacity, year of manufacture and
// serial number live in the fleet register, and until they are entered the fleet
// directory shows a machine with almost nothing against it.
//
// Takes the register's own columns, in its own order, so a block can be pasted
// straight out of the spreadsheet:
//
//   E&C NUMBER | BRAND | TYPE OF VEHICLE | MODEL NO | REGISTRATION NO. | CAPACITY | YEAR | SE.NO
//
// Every change is shown field by field before it is written, because a register
// does not only add — it corrects. DT-79 and DT-58 have each other's model
// numbers in the system, and a silent update would have swapped them back
// without anyone seeing.
//
// An empty cell never blanks a value that is already there: the register is
// often filled in a column at a time, and a gap means "not recorded here", not
// "delete what you have".
//
// A row whose registration number already belongs to a DIFFERENT machine is
// refused. That is a duplicate, and merge_assets.ts is the tool for it — writing
// the plate onto a second machine would create the very thing we have been
// clearing all week.
//
//   npx tsx scripts/upsert_assets.ts --file=data/source-sheets/fleet_register_rows.tsv
//   npx tsx scripts/upsert_assets.ts --file=... --apply
//   npx tsx scripts/upsert_assets.ts --row="DT-58|TATA|Dump Truck|LPK1615TC|LO-8349|03 Cube|2018|MAT395090J2R12371"

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FILE = arg("file");
const ROWS = process.argv.filter((a) => a.startsWith("--row=")).map((a) => a.slice(6));

const clean = (v: unknown) => String(v ?? "").trim();

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

type Row = { code: string; brand: string; typeLabel: string; model: string; regNo: string; capacity: string; yom: string; serialNo: string };

function parse(cells: string[]): Row {
  const [code, brand, typeLabel, model, regNo, capacity, yom, serialNo] = cells.map(clean);
  return { code, brand, typeLabel, model, regNo, capacity, yom, serialNo };
}

function readRows(): Row[] {
  const out: Row[] = [];
  for (const r of ROWS) out.push(parse(r.split("|")));
  if (FILE) {
    if (/\.xlsx?$/i.test(FILE)) {
      const wb = XLSX.readFile(FILE);
      const sheet = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      for (const line of sheet) {
        const cells = line.map(clean);
        // Skip the heading row and anything without a fleet code in column A.
        if (!cells[0] || /e&c|equipment/i.test(cells[0])) continue;
        out.push(parse(cells));
      }
    } else {
      for (const line of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue;
        const cells = line.includes("\t") ? line.split("\t") : line.split("|");
        if (/e&c|equipment/i.test(cells[0] ?? "")) continue;
        out.push(parse(cells));
      }
    }
  }
  return out.filter((r) => r.code);
}

async function main() {
  const rows = readRows();
  if (!rows.length) throw new Error("nothing to do — pass --file=... or --row=...");
  console.log(`\n=== fleet register: ${rows.length} machine(s) (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();

  const cats = await prisma.category.findMany({ select: { id: true, code: true, name: true } });
  const catByCode = new Map(cats.map((c) => [c.code.toUpperCase(), c]));
  const other = cats.find((c) => c.name === "Other Asset");

  let created = 0, updated = 0, unchanged = 0, refused = 0;

  for (const r of rows) {
    const asset = await prisma.asset.findFirst({ where: { code: r.code } });

    // The plate is the one field that must be unique to a machine.
    if (r.regNo) {
      const holder = await prisma.asset.findFirst({ where: { regNo: r.regNo, NOT: asset ? { id: asset.id } : undefined } });
      if (holder) {
        console.log(`\n  ${r.code}  REFUSED — ${r.regNo} already belongs to ${holder.code}`);
        console.log(`      that is a duplicate machine, not a detail to fill in:`);
        console.log(`      npx tsx scripts/merge_assets.ts --from="${holder.code}" --into="${r.code}"`);
        refused++;
        continue;
      }
    }

    const wanted: Record<string, string | number | null> = {};
    if (r.brand) wanted.brand = r.brand;
    if (r.typeLabel) wanted.typeLabel = r.typeLabel;
    if (r.model) wanted.model = r.model;
    if (r.regNo) wanted.regNo = r.regNo;
    if (r.capacity) wanted.capacity = r.capacity;
    if (r.serialNo) wanted.serialNo = r.serialNo;
    if (r.yom && Number.isFinite(Number(r.yom))) wanted.yom = Number(r.yom);

    if (!asset) {
      const prefix = r.code.split(/[-\s]/)[0].toUpperCase();
      const cat = catByCode.get(prefix) ?? other;
      if (!cat) throw new Error(`no category for ${r.code}`);
      // A machine that drives is measured in kilometres; plant runs on hours.
      const meterType = ["DT", "DC", "HCC", "SC", "PV", "BD", "LT", "BM", "BS", "DB", "TM"].includes(prefix) ? "KM" : "HOURS";
      console.log(`\n  ${r.code}  CREATE — not in the fleet`);
      console.log(`      ${cat.name} · meter ${meterType} · ${Object.entries(wanted).map(([k, v]) => `${k}=${v}`).join(" · ") || "no details given"}`);
      created++;
      if (APPLY) await prisma.asset.create({ data: {
        code: r.code, status: "ACTIVE", ownership: "OWNED", meterType,
        categoryId: cat.id, ...wanted } as any });
      continue;
    }

    const changes: string[] = [];
    for (const [k, v] of Object.entries(wanted)) {
      const now = (asset as any)[k];
      if (String(now ?? "") === String(v)) continue;
      changes.push(`${k}: ${now === null || now === "" ? "—" : now}  ->  ${v}`);
    }
    if (!changes.length) { unchanged++; console.log(`\n  ${r.code}  already matches the register`); continue; }
    console.log(`\n  ${r.code}  UPDATE`);
    for (const c of changes) console.log(`      ${c}`);
    updated++;
    if (APPLY) await prisma.asset.update({ where: { id: asset.id }, data: wanted as any });
  }

  console.log(`\n  ${created} created · ${updated} updated · ${unchanged} already correct${refused ? ` · ${refused} refused` : ""}`);
  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
