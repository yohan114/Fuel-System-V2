/**
 * Put the meter readings recorded at each service into the meter history.
 *
 * The legacy service system captured a meter reading on most jobs. Those 1,126
 * readings currently live only on ServiceRecord.meterAtService, so nothing else
 * in the system can see them — not the consumption charts, not billing usage,
 * not the running chart. This copies the trustworthy ones into MeterReading so
 * they count as what they are: a meter read by a fitter on a known date.
 *
 * NOT ALL OF THEM ARE TRUSTWORTHY. The column was typed by hand for three
 * years and contains values up to 15,651,010,099 km. Every reading is checked
 * by src/lib/service/meter-trust.ts before it is written; anything that fails
 * is listed for correction rather than guessed at. In particular, machines that
 * carry two meters (service records tracking one, fuel issues the other) are
 * reported, never merged — merging would silently corrupt both series.
 *
 *   node scripts/insert-service-meter-readings.cjs            # dry run
 *   node scripts/insert-service-meter-readings.cjs --apply
 */
const Database = require("better-sqlite3");

const DB = process.env.FUEL_DB || "data/app.db";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString().replace("Z", "+00:00");
const SOURCE = "SERVICE";

// Mirror of src/lib/service/meter-trust.ts. Kept in step by tests/meter-trust.test.ts;
// this script is plain CJS so it cannot import the TypeScript module directly.
const ABSOLUTE_MAX = { HOURS: 100000, KM: 2000000 };
const isAbsurd = (v, t) => !Number.isFinite(v) || v <= 0 || v > (ABSOLUTE_MAX[t] ?? ABSOLUTE_MAX.KM);
const withinReference = (v, mn, mx) => v >= Math.min(mn, mx) * 0.5 && v <= Math.max(mn, mx) * 2 + 1000;
const isProgressing = (seq) => {
  if (seq.length <= 1) return true;
  let drops = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) drops++;
  return drops <= 1;
};
function checkServiceMeter(value, meterType, reference, ownSequence) {
  if (value == null || value <= 0) return { verdict: "no-value", trusted: false };
  if (isAbsurd(value, meterType)) return { verdict: "absurd", trusted: false };
  if (reference) {
    return withinReference(value, reference.min, reference.max)
      ? { verdict: "ok", trusted: true }
      : { verdict: "scale-mismatch", trusted: false };
  }
  return isProgressing(ownSequence) ? { verdict: "ok", trusted: true } : { verdict: "erratic", trusted: false };
}

const db = new Database(DB);
db.pragma("foreign_keys = ON");
const L = (s = "") => console.log(s);
const pad = (v, n) => String(v ?? "").padEnd(n);

const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
if (!admin) throw new Error("no admin user to attribute the readings to");

// Reference band per asset, from the meters captured on fuel issues.
const reference = new Map();
for (const r of db.prepare(`SELECT assetId, MIN(meterReading) mn, MAX(meterReading) mx
                            FROM FuelIssue WHERE voided = 0 AND meterReading > 0
                            GROUP BY assetId`).all())
  reference.set(r.assetId, { min: r.mn, max: r.mx });

const records = db.prepare(`SELECT s.id, s.assetId, a.code, a.meterType, s.meterAtService AS value,
                                   s.serviceDate, s.sourceRef
                            FROM ServiceRecord s JOIN Asset a ON a.id = s.assetId
                            WHERE s.meterAtService IS NOT NULL
                            ORDER BY a.code, s.serviceDate`).all();

// Each asset's own readings in date order, for the no-reference case.
const ownSeq = new Map();
for (const r of records) {
  if (!ownSeq.has(r.assetId)) ownSeq.set(r.assetId, []);
  ownSeq.get(r.assetId).push(r.value);
}

// Already present? Match on asset + date + value so a re-run is a no-op.
const already = new Set(
  db.prepare(`SELECT assetId || '|' || date(readingDate) || '|' || value AS k
              FROM MeterReading WHERE source = ?`).all(SOURCE).map((r) => r.k)
);
const key = (r) => `${r.assetId}|${String(r.serviceDate).slice(0, 10)}|${r.value}`;

const trusted = [], held = { absurd: [], "scale-mismatch": [], erratic: [] };
for (const r of records) {
  const chk = checkServiceMeter(r.value, r.meterType, reference.get(r.assetId) ?? null, ownSeq.get(r.assetId) ?? []);
  if (chk.trusted) trusted.push(r);
  else (held[chk.verdict] ?? (held[chk.verdict] = [])).push(r);
}
const fresh = trusted.filter((r) => !already.has(key(r)));

L(`\n════ SERVICE METER READINGS -> METER HISTORY  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`  service records carrying a meter reading   ${records.length}`);
L(`  machines involved                          ${new Set(records.map((r) => r.assetId)).size}`);
L(`\n── TRUST CHECK ──`);
L(`  trusted, will be inserted                  ${trusted.length}`);
L(`     already in the meter history            ${trusted.length - fresh.length}`);
L(`     new                                     ${fresh.length}`);
L(`  HELD — impossible values                   ${held.absurd.length}`);
L(`  HELD — machine appears to have two meters  ${held["scale-mismatch"].length}`);
L(`  HELD — readings jump around, no reference  ${held.erratic.length}`);

if (held.absurd.length) {
  L(`\n  ── impossible readings (mis-keyed digits) ──`);
  for (const r of held.absurd.slice(0, 25))
    L(`     ${pad(r.code, 10)} ${String(r.serviceDate).slice(0, 10)}  ${r.meterType.padEnd(5)} ${Number(r.value).toLocaleString()}`);
  if (held.absurd.length > 25) L(`     … ${held.absurd.length - 25} more`);
}
if (held["scale-mismatch"].length) {
  L(`\n  ── two-meter machines (service reads one, fuel issues another) ──`);
  const byAsset = new Map();
  for (const r of held["scale-mismatch"]) {
    if (!byAsset.has(r.code)) byAsset.set(r.code, []);
    byAsset.get(r.code).push(r.value);
  }
  for (const [code, vals] of [...byAsset].slice(0, 25)) {
    const a = records.find((r) => r.code === code);
    const ref = reference.get(a.assetId);
    L(`     ${pad(code, 10)} service ${vals.map((v) => Number(v).toLocaleString()).join(", ").slice(0, 46).padEnd(48)} fuel issues ${ref.min.toLocaleString()}–${ref.max.toLocaleString()}`);
  }
  if (byAsset.size > 25) L(`     … ${byAsset.size - 25} more machines`);
}

if (!APPLY) { L(`\n(DRY-RUN) nothing written — re-run with --apply.`); db.close(); process.exit(0); }

const ins = db.prepare(`INSERT INTO MeterReading (id, value, readingType, readingDate, source, createdAt, assetId, recordedById)
                        VALUES (?,?,?,?,?,?,?,?)`);
const out = db.transaction(() => {
  let n = 0;
  for (const r of fresh) {
    ins.run(crypto.randomUUID(), r.value, r.meterType, r.serviceDate, SOURCE, NOW, r.assetId, admin.id);
    n++;
  }
  db.prepare(`INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), "CREATE", "MeterReading", null,
    `Added ${n} meter readings taken at service into the meter history, from the imported service jobs. ${held.absurd.length} were held back as impossible values, ${held["scale-mismatch"].length} because the machine's service meter and fuel-issue meter are different instruments, and ${held.erratic.length} because the readings do not progress.`,
    JSON.stringify({ inserted: n, trusted: trusted.length, heldAbsurd: held.absurd.length,
      heldScaleMismatch: held["scale-mismatch"].length, heldErratic: held.erratic.length,
      absurdCodes: [...new Set(held.absurd.map((r) => r.code))],
      twoMeterCodes: [...new Set(held["scale-mismatch"].map((r) => r.code))] }),
    NOW, admin.id);

  const post = db.prepare("SELECT COUNT(*) n FROM MeterReading WHERE source = ?").get(SOURCE).n;
  const bad = db.prepare(`SELECT COUNT(*) n FROM MeterReading m JOIN Asset a ON a.id = m.assetId
     WHERE m.source = ? AND (m.value <= 0
       OR (a.meterType='HOURS' AND m.value > 100000) OR (a.meterType='KM' AND m.value > 2000000))`).get(SOURCE).n;
  L(`\n── RECONCILIATION ──`);
  L(`  service-sourced readings now present  ${post}   (expected ${trusted.length})`);
  L(`  impossible values among them          ${bad}   (must be 0)`);
  if (post !== trusted.length || bad > 0) throw new Error("reconciliation failed — refusing to commit");
  return n;
})();

L(`\n✓ APPLIED. ${out} meter readings added.`);
L(`  foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
db.close();
