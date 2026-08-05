import * as fs from "fs";

// Compare two fuel exports before merging them, and say whether merging would
// double-count. READ-ONLY — touches no database.
//
// Two instances that were seeded from overlapping paperwork can hold the same
// physical refuel under different spellings: a different source label, a date
// shifted by a timezone, a monthly total on one side against daily rows on the
// other. An additive merge cannot tell those apart from genuinely new fuel, so
// it silently inflates the totals — which is exactly what Galagedara turned out
// to be, where one set of refuels appeared twice under two labels.
//
// Exact natural-key matching answers "is this literally the same row". It does
// not answer "is this the same fuel", so this also compares litres per vehicle
// per month: a month where both sides hold fuel for one vehicle but the rows do
// not match is the shape that needs a human look before any merge.
//
//   npx tsx scripts/compare_fuel_exports.ts data/fuel-data-export.json /path/vps-live.json

const [fileA, fileB] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!fileA || !fileB) { console.error("usage: compare_fuel_exports.ts <a.json> <b.json>"); process.exit(1); }

const load = (f: string) => {
  if (!fs.existsSync(f)) { console.error(`not found: ${f}`); process.exit(1); }
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!/^fuel-(data|issues)-export$/.test(p.kind)) { console.error(`not a fuel export: ${f}`); process.exit(1); }
  return p;
};

const nameOf = (f: string) => f.split("/").pop() || f;
const key = (i: any) => `${i.asset}|${i.date}|${i.litres}|${i.source}|${i.pricePerLitre}`;
const ym = (iso: string) => iso.slice(0, 7);
const L = (n: number) => n.toFixed(0).padStart(7);

function counted<T>(rows: T[], k: (r: T) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(k(r), (m.get(k(r)) || 0) + 1);
  return m;
}
// how many of A's rows are not covered by B's, counting duplicates properly
function surplus(a: Map<string, number>, b: Map<string, number>) {
  let n = 0;
  for (const [k, c] of a) n += Math.max(0, c - (b.get(k) || 0));
  return n;
}

const A = load(fileA), B = load(fileB);
const nA = nameOf(fileA), nB = nameOf(fileB);
const pad = Math.max(nA.length, nB.length, 10);

console.log(`\n=== Comparing fuel exports ===`);
console.log(`  A = ${nA}   (exported ${A.exportedAt})`);
console.log(`  B = ${nB}   (exported ${B.exportedAt})\n`);

const rows: [string, number, number][] = [
  ["fuel issues", A.issues?.length || 0, B.issues?.length || 0],
  ["tanks", A.tanks?.length || 0, B.tanks?.length || 0],
  ["replenishments", A.bulkRequests?.length || 0, B.bulkRequests?.length || 0],
  ["meter readings", A.meterReadings?.length || 0, B.meterReadings?.length || 0],
  ["site allocations", A.assignments?.length || 0, B.assignments?.length || 0],
  ["assets", A.assets?.length || 0, B.assets?.length || 0],
];
console.log(`  ${"".padEnd(18)}${"A".padStart(9)}${"B".padStart(11)}`);
for (const [l, a, b] of rows) console.log(`  ${l.padEnd(18)}${String(a).padStart(9)}${String(b).padStart(11)}`);

// ------------------------------------------------------------- exact matching
const kA = counted<any>(A.issues || [], key), kB = counted<any>(B.issues || [], key);
const onlyA = surplus(kA, kB), onlyB = surplus(kB, kA);
const shared = (A.issues?.length || 0) - onlyA;
console.log(`\n--- fuel issues, exact row match ---`);
console.log(`  identical on both sides : ${shared}`);
console.log(`  only in A               : ${onlyA}`);
console.log(`  only in B               : ${onlyB}`);

// ---------------------------------------------- same fuel recorded differently
const vmA = new Map<string, number>(), vmB = new Map<string, number>();
for (const i of A.issues || []) vmA.set(`${i.asset}|${ym(i.date)}`, (vmA.get(`${i.asset}|${ym(i.date)}`) || 0) + i.litres);
for (const i of B.issues || []) vmB.set(`${i.asset}|${ym(i.date)}`, (vmB.get(`${i.asset}|${ym(i.date)}`) || 0) + i.litres);

const both = [...vmA.keys()].filter((k) => vmB.has(k));
const suspicious = both.filter((k) => {
  // both sides hold fuel for this vehicle-month; if the rows were identical the
  // exact match above already covered them, so a mismatch here is the risk
  return Math.abs((vmA.get(k) || 0) - (vmB.get(k) || 0)) > 0.5 || onlyB > 0;
});
console.log(`\n--- overlap risk: vehicle-months present on BOTH sides ---`);
console.log(`  vehicle-months in A: ${vmA.size} · in B: ${vmB.size} · in both: ${both.length}`);
if (!both.length) {
  console.log(`  none — the two sets never describe the same vehicle in the same month,`);
  console.log(`  so an additive merge cannot double-count.`);
} else {
  console.log(`\n  ${"vehicle-month".padEnd(24)}${"A litres".padStart(9)}${"B litres".padStart(10)}   verdict`);
  let same = 0;
  for (const k of both.sort()) {
    const a = vmA.get(k) || 0, b = vmB.get(k) || 0;
    const identical = Math.abs(a - b) < 0.5;
    if (identical) same++;
    if (suspicious.length <= 60 || !identical)
      console.log(`  ${k.padEnd(24)}${L(a)}${L(b)}   ${identical ? "same total — likely the SAME fuel" : "DIFFERENT totals"}`);
  }
  console.log(`\n  ${same} of ${both.length} vehicle-months carry the same litres on both sides.`);
  console.log(`  Those are the same refuels recorded twice; merging them would double the site's fuel.`);
}

// ------------------------------------------------------------- other datasets
const mrA = counted<any>(A.meterReadings || [], (m) => `${m.asset}|${m.readingDate}|${m.value}`);
const mrB = counted<any>(B.meterReadings || [], (m) => `${m.asset}|${m.readingDate}|${m.value}`);
const asA = counted<any>(A.assignments || [], (x) => `${x.asset}|${x.project}|${x.startDate}`);
const asB = counted<any>(B.assignments || [], (x) => `${x.asset}|${x.project}|${x.startDate}`);
const rqA = counted<any>(A.bulkRequests || [], (r) => `${r.tank}|${r.litres}|${r.createdAt}`);
const rqB = counted<any>(B.bulkRequests || [], (r) => `${r.tank}|${r.litres}|${r.createdAt}`);
console.log(`\n--- what each side would contribute ---`);
console.log(`  meter readings   only in A ${surplus(mrA, mrB)} · only in B ${surplus(mrB, mrA)}`);
console.log(`  site allocations only in A ${surplus(asA, asB)} · only in B ${surplus(asB, asA)}`);
console.log(`  replenishments   only in A ${surplus(rqA, rqB)} · only in B ${surplus(rqB, rqA)}`);

const codesA = new Set((A.assets || []).map((a: any) => a.code));
const codesB = new Set((B.assets || []).map((a: any) => a.code));
const missB = [...codesA].filter((c) => !codesB.has(c));
const missA = [...codesB].filter((c) => !codesA.has(c));
console.log(`  vehicles in A but not B: ${missB.length}${missB.length ? ` (${missB.slice(0, 8).join(", ")}${missB.length > 8 ? " …" : ""})` : ""}`);
console.log(`  vehicles in B but not A: ${missA.length}${missA.length ? ` (${missA.slice(0, 8).join(", ")}${missA.length > 8 ? " …" : ""})` : ""}`);
console.log();
