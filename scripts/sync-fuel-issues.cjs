/**
 * Take the fuel issues the site instance has and this one does not.
 *
 * Dry-run by default; pass --apply to commit.
 *
 *   node scripts/sync-fuel-issues.cjs --from="<path to the other app.db>"
 *   node scripts/sync-fuel-issues.cjs --from="..." --apply
 *
 * The two databases share a lineage — most rows carry the same uuid in both —
 * so an unmatched id is the first sign of something new. It is not proof: the
 * same refuel re-imported from a workbook gets a fresh uuid, and 111 of the 247
 * unmatched rows in the August 2026 sync were exactly that. So a candidate is
 * also matched on content — machine, Colombo day, litres, tank — and counted as
 * a MULTISET rather than a set, because a site generator genuinely takes the
 * same litres twice in a day and treating the second as a duplicate would drop
 * real diesel on the floor.
 *
 * Two things it refuses to do on its own:
 *
 *   an issue against a machine this database has never heard of is held back,
 *   with anything in the fleet that looks like it. Creating the asset would put
 *   another unpriced code in the fleet, and four of the five in the August sync
 *   were typos of machines already there — "48_-4849" for BM-01's 48-4849.
 *
 *   a pile of identical rows on one machine-day is held back. The August sync
 *   offered 22 GE-62 rows for April and May — eleven identical 10 L issues on
 *   each of two days against the one this database holds — which is a register
 *   imported twice on the other side, not ten refuels. The distribution says so
 *   plainly: of the 136 rows on offer, 104 landed one to a machine-day and six
 *   landed two, and only those two GE-62 keys landed ten. A machine topping up
 *   twice with the same litres is ordinary; ten times is a story someone should
 *   tell you before it reaches an invoice. Raise --max-repeat to take them.
 *
 * A month whose invoices have been ISSUED is never touched: fuel arriving under
 * a bill the client already holds is a credit note's business, not a sync's.
 * DRAFT months are fair game — that is what a draft is for.
 */
const Database = require("better-sqlite3");
const path = require("path");

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
const APPLY = process.argv.includes("--apply");
const MAX_REPEAT = parseInt(arg("max-repeat") || "2", 10);
const FROM = arg("from");
if (!FROM) {
  console.error('usage: node scripts/sync-fuel-issues.cjs --from="<other app.db>" [--apply] [--max-repeat=N]');
  process.exit(1);
}

const db = new Database(path.join(process.cwd(), "data", "app.db"));
const src = new Database(FROM, { readonly: true });

const colomboDay = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const alnum = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const n0 = (v) => Math.round(v).toLocaleString("en-LK");
const rs = (c) => "Rs " + Math.round(c / 100).toLocaleString("en-LK");
const pad = (v, w) => String(v ?? "").padEnd(w);
const padL = (v, w) => String(v ?? "").padStart(w);

// ── what we already hold ────────────────────────────────────────────────────
const key = (r) => `${r.assetId}|${colomboDay(r.issueDate)}|${r.litres}|${r.bulkTankId || "-"}`;
const held = new Map();
for (const r of db.prepare("SELECT assetId, issueDate, litres, bulkTankId FROM FuelIssue").all()) {
  held.set(key(r), (held.get(key(r)) || 0) + 1);
}
// The dedup below spends `held` as it matches candidates off against it, so the
// counts for reporting are taken now.
const heldOriginally = new Map(held);
const ourIds = new Set(db.prepare("SELECT id FROM FuelIssue").all().map((r) => r.id));
const ourAssets = new Map(db.prepare("SELECT id, code FROM Asset").all().map((r) => [r.id, r.code]));
const ourTanks = new Set(db.prepare("SELECT id FROM BulkTank").all().map((r) => r.id));
const ourUsers = new Set(db.prepare("SELECT id FROM User").all().map((r) => r.id));
const fleet = db.prepare("SELECT code, regNo, status FROM Asset").all();

// Months whose invoices have gone to a client. DRAFT months are deliberately
// NOT here: a draft exists to absorb exactly this kind of late arrival, and
// treating every billed month as closed would have blocked the whole of August,
// which is the data the sync exists to bring in.
const issuedMonths = new Set(
  db.prepare("SELECT DISTINCT periodKey FROM Bill WHERE status IN ('ISSUED','PAID','OVERDUE')").all().map((r) => r.periodKey),
);

// ── candidates ──────────────────────────────────────────────────────────────
const srcAssets = new Map(src.prepare("SELECT id, code, regNo, typeLabel FROM Asset").all().map((r) => [r.id, r]));
const srcTanks = new Map(
  src.prepare("SELECT t.id, t.name, p.code AS site FROM BulkTank t LEFT JOIN Project p ON p.id = t.projectId").all().map((r) => [r.id, r]),
);

const candidates = src
  .prepare("SELECT * FROM FuelIssue ORDER BY issueDate, id")
  .all()
  .filter((r) => !ourIds.has(r.id));

const fresh = [];
let coveredByContent = 0;
for (const r of candidates) {
  const k = key(r);
  const n = held.get(k) || 0;
  if (n > 0) { held.set(k, n - 1); coveredByContent++; continue; }
  fresh.push(r);
}

// How many new rows would land on one identical machine-day-litres-tank. One
// or two is a refuel; ten is a register imported twice.
const repeats = new Map();
for (const r of fresh) repeats.set(key(r), (repeats.get(key(r)) || 0) + 1);

// ── sort into what can be taken and what cannot ─────────────────────────────
const importable = [], unknownAsset = [], issuedMonth = [], tooRepeated = [];
for (const r of fresh) {
  const period = colomboDay(r.issueDate).slice(0, 7);
  if (!ourAssets.has(r.assetId)) { unknownAsset.push(r); continue; }
  if (issuedMonths.has(period)) { issuedMonth.push(r); continue; }
  if ((repeats.get(key(r)) || 0) > MAX_REPEAT) { tooRepeated.push(r); continue; }
  importable.push(r);
}

const near = (code) => {
  const t = alnum(code), digits = t.replace(/[^0-9]/g, "");
  return fleet
    .filter((x) => alnum(x.code) === t || alnum(x.regNo) === t || (digits.length >= 4 && (alnum(x.code).includes(digits) || alnum(x.regNo).includes(digits))))
    .map((x) => `${x.code}${x.regNo ? ` / ${x.regNo}` : ""}`);
};

console.log(`\n════ FUEL ISSUE SYNC  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
console.log(`  from ${FROM}`);
console.log(`\n  ${padL(candidates.length, 6)}  issues the other database has under an id we do not hold`);
console.log(`  ${padL(coveredByContent, 6)}  of those are refuels we already hold under a different id`);
console.log(`  ${padL(fresh.length, 6)}  genuinely absent from our books`);
console.log(`  ${padL(importable.length, 6)}  ready to take · ${n0(importable.reduce((s, r) => s + r.litres, 0))} L · ${rs(importable.reduce((s, r) => s + r.totalCost, 0))}`);

if (importable.length) {
  const byDay = new Map();
  for (const r of importable) {
    const d = colomboDay(r.issueDate);
    const site = srcTanks.get(r.bulkTankId)?.site || "(no tank)";
    if (!byDay.has(d)) byDay.set(d, new Map());
    byDay.get(d).set(site, (byDay.get(d).get(site) || 0) + r.litres);
  }
  console.log(`\n  by day:`);
  for (const [d, m] of [...byDay.entries()].sort()) {
    console.log(`    ${d}  ${[...m.entries()].map(([s, l]) => `${s} ${n0(l)} L`).join("   ")}`);
  }
}

if (tooRepeated.length) {
  console.log(`\n  HELD BACK — ${tooRepeated.length} rows repeat one machine-day more than ${MAX_REPEAT} times:`);
  const g = new Map();
  for (const r of tooRepeated) {
    const k = key(r);
    if (!g.has(k)) {
      g.set(k, {
        n: 0, l: 0, each: r.litres,
        d: colomboDay(r.issueDate),
        code: srcAssets.get(r.assetId)?.code || r.assetId,
        ours: heldOriginally.get(k) || 0,
      });
    }
    const e = g.get(k); e.n++; e.l += r.litres;
  }
  for (const e of [...g.values()].sort((a, b) => b.n - a.n)) {
    console.log(
      `    ${e.d}  ${pad(e.code, 12)} ${padL(e.n, 3)} more × ${n0(e.each)} L = ${padL(n0(e.l), 6)} L` +
      `   we already hold ${e.ours} on that day`,
    );
  }
  console.log(`    pass --max-repeat=N to take them.`);
}

if (issuedMonth.length) {
  console.log(`\n  HELD BACK — ${issuedMonth.length} rows fall in a month whose invoices have been issued.`);
  console.log(`    Fuel arriving under a bill the client holds needs a credit note, not a sync.`);
}

if (unknownAsset.length) {
  console.log(`\n  HELD BACK — ${unknownAsset.length} rows against machines this database does not have:`);
  for (const r of unknownAsset) {
    const a = srcAssets.get(r.assetId);
    const code = a?.code || r.assetId;
    const hits = near(code);
    console.log(
      `    ${colomboDay(r.issueDate)}  ${pad(code, 12)} ${padL(n0(r.litres), 5)} L  ` +
      (hits.length ? `looks like ${hits.join(", ")}` : "nothing like it in our fleet"),
    );
  }
}

// ── write ───────────────────────────────────────────────────────────────────
if (!importable.length) {
  console.log(`\n  Nothing to take.\n`);
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO FuelIssue (id, fuelKind, litres, meterReading, readingType, pricePerLitre, totalCost,
                         source, issueDate, createdAt, assetId, issuedById, fuelPriceId, linkedRequestId,
                         meterReadingRecordId, bulkTankId, voided, voidedAt, photoData, photoName,
                         photoMime, issuePerson)
  VALUES (@id, @fuelKind, @litres, @meterReading, @readingType, @pricePerLitre, @totalCost,
          @source, @issueDate, @createdAt, @assetId, @issuedById, @fuelPriceId, @linkedRequestId,
          @meterReadingRecordId, @bulkTankId, @voided, @voidedAt, @photoData, @photoName,
          @photoMime, @issuePerson)
`);

const write = db.transaction((rows) => {
  for (const r of rows) {
    insert.run({
      ...r,
      // Foreign keys this database cannot honour are dropped rather than made
      // up: the row's own facts — machine, litres, price, date — are what matter,
      // and a dangling reference would fail the insert or lie about a link.
      fuelPriceId: r.fuelPriceId,
      linkedRequestId: null,
      meterReadingRecordId: null,
      bulkTankId: r.bulkTankId && ourTanks.has(r.bulkTankId) ? r.bulkTankId : null,
      issuedById: r.issuedById && ourUsers.has(r.issuedById) ? r.issuedById : null,
      // Keep the original id. The next sync recognises these as already held
      // instead of offering them again under a new one.
      id: r.id,
    });
  }
});

if (APPLY) {
  // A price id from the other instance may not exist here; blank it rather than
  // fail the whole batch on a foreign key.
  const ourPrices = new Set(db.prepare("SELECT id FROM FuelPrice").all().map((r) => r.id));
  for (const r of importable) if (r.fuelPriceId && !ourPrices.has(r.fuelPriceId)) r.fuelPriceId = null;
  write(importable);
  console.log(`\n  ✓ took ${importable.length} issues.`);
  const after = db.prepare("SELECT COUNT(*) n, MAX(issueDate) d FROM FuelIssue").get();
  console.log(`    fuel issues now ${n0(after.n)}, latest ${String(after.d).slice(0, 10)}\n`);
} else {
  console.log(`\n  (dry-run) nothing written — re-run with --apply.\n`);
}

db.close();
src.close();
