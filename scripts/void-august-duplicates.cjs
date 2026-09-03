// Void the nineteen August 2026 fuel issues confirmed as duplicates.
//
//     node scripts/void-august-duplicates.cjs                 # dry run
//     node scripts/void-august-duplicates.cjs --apply
//     DB=/var/lib/fuel-system/app.db node scripts/void-august-duplicates.cjs --apply
//
// Two faults, nineteen rows, 470 L, Rs 181,890. August is still entirely DRAFT —
// 203 bills, every invoiceNumber null — so nothing here reaches a client.
//
// FAULT 1 — a load that ran three times on 7 August (14 rows).
// The same readings were written at 09:08, 11:02 and 11:31 UTC. CR-01 proves it:
// its five 09:08 rows carry readingType HOURS, and the 11:02 rows repeat the
// identical meters 3280/3285/3292/3299/3306 stamped readingType KM — on a
// machine whose meterType is HOURS. Twelve of the fleet's duplicate groups carry
// that same readingType disagreement.
//
// FAULT 2 — duplicate ASSET records (5 rows).
// TM-21 shares both a registration (ZA-0050) and a serial (MAT449019H2R08190)
// with ZB-0050. ZB-0050 has 74 lifetime fills, TM-21 has 3 — each with an
// exact-litre twin under ZB-0050 on the same day. VP-60, created 8 August with
// two fills ever, repeats VR-60's readings 1629 and 1630 exactly.
//
// WHY THIS DOES NOT USE THE APP'S VOID PATH. recordFuelVoid credits the tank
// (+litres) on the assumption the issue debited it when created. None of these
// nineteen rows has a single AuditLog entry: they were written straight into the
// database and never moved a balance. Crediting 470 L back would invent fuel in
// tanks that never lost it. So this sets the voided flag and writes the audit
// entry itself, and leaves every BulkTank untouched.
//
// Safety, checked at run time rather than assumed: every row must still exist,
// still be live, and still have its fuel recorded somewhere else — under the
// same machine that day, or under the machine it was duplicated from. A row that
// fails any of those is skipped and reported, never voided.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "data/app.db";

// id → the machine its fuel is recorded under. Same code = a repeat of the same
// row; a different code = a duplicate asset record, and the fuel lives there.
const TARGETS = [
  // 7 August re-load
  ["b91ca749-94e2-4da8-8ef4-694de61982eb", "CR-01", "CR-01"],
  ["c33bc926-3bf9-43ed-a0d7-eabd0bf07bb5", "CR-01", "CR-01"],
  ["af7a20e4-91cc-40c3-a1df-33e5aa3de4b8", "CR-01", "CR-01"],
  ["84875665-0161-46e0-9943-212a20c20954", "CR-01", "CR-01"],
  ["760a0222-0b88-4665-aead-5fe591e40c84", "CR-01", "CR-01"],
  ["43107e96-8d10-491a-b1e6-67a8a1f999cc", "CR-01", "CR-01"],
  ["20e3d868-d4bd-46a4-b409-60ac01789898", "DT-74", "DT-74"],
  ["6aae42a8-c1bb-440e-88a8-e5ec6572bb47", "DT-74", "DT-74"],
  ["c4a49850-6b8f-4da7-9a0d-06af691acd7d", "TM-14", "TM-14"],
  ["a42503af-01c1-474e-a598-fbb39d9610d6", "TM-14", "TM-14"],
  ["286b7f86-276f-447e-b875-0fc8a1018b59", "TM-16", "TM-16"],
  ["d870b209-3468-4a04-8c27-9cfe9452278b", "TM-16", "TM-16"],
  ["f27ffaf4-da01-4d69-ae0d-4f65f1b55c5d", "TM-18", "TM-18"],
  ["c7637cd5-7d26-47de-bfb3-87ee19c3d5a2", "TM-18", "TM-18"],
  // duplicate asset records — fuel is recorded under the real machine
  ["d53ab359-a6c0-4008-afb1-17fa9d538a1a", "TM-21", "ZB-0050"],
  ["d464f93f-9801-44ae-a20e-87c5c771bcd7", "TM-21", "ZB-0050"],
  ["5ce0c835-95c2-42a3-b64d-a7c938f8484d", "TM-21", "ZB-0050"],
  ["cd32f409-cc07-419b-a213-0037a0682bd2", "VP-60", "VR-60"],
  ["8592e1da-f730-4573-b5b1-68439d162762", "VP-60", "VR-60"],
];

const db = new Database(DB_PATH);
const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const rs = (c) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

console.log(`\n=== Void August duplicates (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
if (!admin) throw new Error("no ADMIN user to attribute the voids to");

const doomed = new Set(TARGETS.map(([id]) => id));
const plan = [];
const skipped = [];

for (const [id, expectCode, survivorCode] of TARGETS) {
  const row = db.prepare(`
    SELECT f.*, a.code, a.meterType FROM FuelIssue f
    JOIN Asset a ON a.id = f.assetId WHERE f.id = ?`).get(id);

  if (!row) { skipped.push([id, expectCode, "not found — already removed?"]); continue; }
  if (row.voided) { skipped.push([id, row.code, "already voided"]); continue; }
  if (row.code !== expectCode) { skipped.push([id, row.code, `expected ${expectCode} — refusing`]); continue; }

  // The fuel must still exist somewhere after this row goes.
  const survivor = db.prepare(`
    SELECT f.id, f.litres FROM FuelIssue f
    JOIN Asset a ON a.id = f.assetId
    WHERE a.code = ? AND f.voided = 0
      AND date(f.issueDate,'+5 hours','+30 minutes') = date(?,'+5 hours','+30 minutes')`)
    .all(survivorCode, row.issueDate)
    .filter((s) => !doomed.has(s.id));

  if (!survivor.length) {
    skipped.push([id, row.code, `NOTHING would survive on ${day(row.issueDate)} — refusing`]);
    continue;
  }

  plan.push({ row, survivorCode, survives: survivor.map((s) => s.litres).join("+") });
}

for (const p of plan) {
  const under = p.survivorCode === p.row.code ? "same machine" : `under ${p.survivorCode}`;
  console.log(
    `  ${p.row.id.slice(0, 8)}  ${p.row.code.padEnd(8)}${day(p.row.issueDate)}  ` +
    `${String(p.row.litres).padStart(5)} L  ${rs(p.row.totalCost).padStart(12)}   ` +
    `fuel survives ${under} (${p.survives} L)`);
}

if (skipped.length) {
  console.log("\n  SKIPPED:");
  for (const [id, code, why] of skipped) console.log(`    ${id.slice(0, 8)}  ${String(code).padEnd(8)}${why}`);
}

const litres = plan.reduce((s, p) => s + p.row.litres, 0);
const cost = plan.reduce((s, p) => s + p.row.totalCost, 0);
console.log(`\n  to void: ${plan.length} rows · ${Math.round(litres * 10) / 10} L · ${rs(cost)}`);
console.log("  bulk tank balances: UNTOUCHED (these rows never debited one)");

if (!APPLY) {
  console.log("\nDRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

const now = new Date().toISOString().replace("Z", "+00:00");
db.transaction(() => {
  for (const p of plan) {
    db.prepare("UPDATE FuelIssue SET voided=1, voidedAt=? WHERE id=?").run(now, p.row.id);
    const why = p.survivorCode === p.row.code
      ? `a re-run of the 7 August load; the same reading is already recorded on ${day(p.row.issueDate)}`
      : `${p.row.code} is a duplicate record of ${p.survivorCode}, which carries this fill`;
    db.prepare(`INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt)
                VALUES (?,?,?,?,?,?,?)`).run(
      randomUUID(), admin.id, "UPDATE", "FuelIssue", p.row.id,
      `Voided duplicate: ${p.row.code} ${p.row.litres} L on ${day(p.row.issueDate)} (${rs(p.row.totalCost)}) — ${why}. ` +
      `Tank balance deliberately not credited: this row has no AuditLog CREATE, so it never debited one.`,
      now);
  }
}) ();

db.pragma("wal_checkpoint(TRUNCATE)");

const left = db.prepare(`SELECT COUNT(*) n FROM FuelIssue
  WHERE voided=0 AND issueDate >= '2026-07-31T18:30:00.000+00:00'
    AND issueDate < '2026-08-31T18:30:00.000+00:00'`).get().n;
const lit = db.prepare(`SELECT ROUND(SUM(litres),2) s FROM FuelIssue
  WHERE voided=0 AND issueDate >= '2026-07-31T18:30:00.000+00:00'
    AND issueDate < '2026-08-31T18:30:00.000+00:00'`).get().s;

console.log(`\n  August now: ${left} live issues · ${lit} L`);
console.log("  Re-generate the August drafts so the bills pick this up.\n");
db.close();
