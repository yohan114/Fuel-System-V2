import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Give a machine its rate card, from figures someone read off the rate card.
//
// A machine with no rate is posted, earns its prorated guarantee in hours or
// km — and then multiplies it by nothing. It bills zero, silently, every month.
//
// assign_missing_rates.ts fills these by cloning whatever category the type
// label pattern-matches. That works for a machine imported with a real type and
// fails quietly for one imported as "Unclassified — set type", which is most of
// the ones still missing. Rental rates are contract money; this script asks for
// them instead of inferring them.
//
// Rates are entered in RUPEES per unit, as written on the card, and stored as
// cents. Three tiers, all optional: fw = full wet (fuel + operator), w = wet,
// d = dry. Billing falls back to the wet tier when a basis is not forced.
//
// --basis pins which tier the machine bills on by default: "d" (dry, rental
// only — no fuel is charged), "w" (wet, fuel included) or "fw" (full wet).
// Without it, billing falls back to wet.
//
//   npx tsx scripts/set_rental_rate.ts --code=PE-3723 --mode=hourly --w=2400
//   npx tsx scripts/set_rental_rate.ts --code=DAG-4969 --mode=perkm --fw=110 --w=70 --d=45 --apply
//   npx tsx scripts/set_rental_rate.ts --code=WG-13 --mode=portable --w=9500 --d=6500 --basis=d --apply
//   npx tsx scripts/set_rental_rate.ts --file=rates.csv --apply
//
// The CSV wants a header and one machine per line — blanks mean "no such tier":
//
//   code,mode,fw,w,d
//   PE-3723,hourly,,2400,
//   DAG-4969,perkm,110,70,45

const APPLY = process.argv.includes("--apply");
const REPLACE = process.argv.includes("--replace");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BASIS = arg("basis");
if (BASIS && !["fw", "w", "d"].includes(BASIS)) throw new Error(`--basis must be fw, w or d — got "${BASIS}"`);

type Row = { code: string; mode: string; fw: number | null; w: number | null; d: number | null };

const MODES = new Set(["hourly", "perkm", "perday", "portable"]);
const rs = (c: number | null) => (c == null ? "—" : "Rs " + Math.round(c / 100).toLocaleString("en-LK"));
const rupees = (s: string | undefined): number | null => {
  const t = String(s ?? "").trim().replace(/[,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${s}" is not a rate`);
  return Math.round(n * 100); // rupees -> cents
};

function readRows(): Row[] {
  const file = arg("file");
  const lines: string[] = [];
  if (file) lines.push(...fs.readFileSync(file, "utf8").split(/\r?\n/));
  else {
    const code = arg("code");
    if (!code) throw new Error("need --code=CODE --mode=hourly|perkm|perday|portable, or --file=rates.csv");
    lines.push([code, arg("mode") ?? "", arg("fw") ?? "", arg("w") ?? "", arg("d") ?? ""].join(","));
  }
  const out: Row[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^code\b/i.test(line)) continue;
    const [code, mode, fw, w, d] = line.split(",").map((x) => x.trim());
    if (!MODES.has(mode)) throw new Error(`"${code}": mode must be one of ${[...MODES].join(", ")} — got "${mode}"`);
    const row = { code, mode, fw: rupees(fw), w: rupees(w), d: rupees(d) };
    if (row.fw == null && row.w == null && row.d == null) throw new Error(`"${code}": no rate given on any tier`);
    out.push(row);
  }
  if (!out.length) throw new Error("no rows to set");
  return out;
}

// Only the columns for the machine's own billing mode are written. Setting an
// hourly rate on a km-metered machine is a typo that would never show up as one.
function columnsFor(mode: string, r: Row) {
  if (mode === "hourly") return { hrFwCents: r.fw, hrWCents: r.w, hrDCents: r.d };
  if (mode === "perkm") return { kmFwCents: r.fw, kmWCents: r.w, kmDCents: r.d };
  if (mode === "portable") return { portDwCents: r.w ?? r.fw, portDdCents: r.d };
  return { dyFwCents: r.fw, dyWCents: r.w, dyDCents: r.d };
}

const expectedMeter = (mode: string) => (mode === "hourly" ? "HOURS" : mode === "perkm" ? "KM" : null);

async function main() {
  const rows = readRows();
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`\n=== set rental rates (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}\n`);

  const assets = await prisma.asset.findMany({
    where: { code: { in: rows.map((r) => r.code) } },
    include: { rentalRate: true, category: { select: { name: true } } } });
  const byCode = new Map(assets.map((a) => [a.code, a]));

  const missing = rows.filter((r) => !byCode.has(r.code)).map((r) => r.code);
  if (missing.length) throw new Error(`not in the fleet: ${missing.join(", ")} — nothing written`);

  // A rate already on record is a decision someone made. Overwriting one is a
  // different act from filling a blank, so it needs saying out loud.
  const held = rows.filter((r) => byCode.get(r.code)!.rentalRate);
  if (held.length && !REPLACE) {
    console.log(`  these already have a rate card: ${held.map((r) => r.code).join(", ")}`);
    console.log(`  pass --replace to overwrite them — nothing was written.\n`);
    throw new Error(`${held.length} machine(s) already rated`);
  }

  let set = 0;
  for (const r of rows) {
    const a = byCode.get(r.code)!;
    const want = expectedMeter(r.mode);
    const warn = want && a.meterType !== want
      ? `   ! this machine's meter is ${a.meterType}, not ${want} — it will not bill ${r.mode}` : "";
    console.log(`  ${a.code.padEnd(12)}${(a.category?.name ?? "—").padEnd(28)}${r.mode.padEnd(10)}` +
      `fw ${rs(r.fw).padEnd(12)}w ${rs(r.w).padEnd(12)}d ${rs(r.d)}` +
      `${BASIS ? `   bills on ${BASIS === "d" ? "DRY — no fuel charged" : BASIS.toUpperCase()}` : ""}` +
      `${a.rentalRate ? "   (replacing)" : ""}${warn}`);
    if (!APPLY) continue;
    const cols = columnsFor(r.mode, r);
    await prisma.rentalRate.upsert({
      where: { assetId: a.id },
      create: { assetId: a.id, equipType: r.mode === "portable" ? "PORTABLE" : "FLEET",
        category: a.category?.name ?? null, sourceLabel: "set by hand from the rate card",
        ...(BASIS ? { defaultBasis: BASIS } : {}), ...cols },
      update: { ...(BASIS ? { defaultBasis: BASIS } : {}), ...cols } });
    set++;
  }

  console.log(`\n  ${APPLY ? `${set} rate card(s) written` : `${rows.length} rate card(s) to write`}`);
  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
