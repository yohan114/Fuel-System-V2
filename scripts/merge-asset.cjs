/**
 * Merge one asset record into another.
 *
 * Two records for one machine happen when a registration is keyed wrong on a
 * fuel sheet: DAC-6545 collected January's diesel, then somebody corrected the
 * plate to DAH-6545 and February onwards went to a second record. The machine
 * never moved and never had two sets of fuel — only the paperwork split.
 *
 * The merge moves every reference from the losing record to the surviving one,
 * collapses their site attachments into a single continuous presence starting
 * at the EARLIER arrival (that first date is what billing prorates from), then
 * removes the empty husk.
 *
 * REFUSES TO RUN if the two records ever drew fuel on the same day — one machine
 * cannot fuel twice in two places, so that would prove they are NOT the same
 * machine and the merge would silently destroy a real vehicle's history.
 *
 *   node scripts/merge-asset.cjs --from DAC-6545 --into DAH-6545
 *   node scripts/merge-asset.cjs --from DAC-6545 --into DAH-6545 --ownership HIRED --apply
 */
const Database = require("better-sqlite3");

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const FROM = arg("from");
const INTO = arg("into");
const OWNERSHIP = arg("ownership");
const APPLY = process.argv.includes("--apply");
if (!FROM || !INTO) throw new Error("usage: --from <code> --into <code> [--ownership HIRED] [--apply]");

const db = new Database(process.env.FUEL_DB || "data/app.db");
db.pragma("foreign_keys = ON");
const L = (s = "") => console.log(s);
const NOW = new Date().toISOString().replace("Z", "+00:00");
const cd = (e) => `date(datetime(${e},'+5 hours','+30 minutes'))`;
const atColombo = (d) => new Date(`${d}T00:00:00+05:30`).toISOString().replace("Z", "+00:00");

const loser = db.prepare("SELECT * FROM Asset WHERE code = ?").get(FROM);
const keeper = db.prepare("SELECT * FROM Asset WHERE code = ?").get(INTO);
if (!loser) throw new Error(`no asset with code ${FROM}`);
if (!keeper) throw new Error(`no asset with code ${INTO}`);
if (loser.id === keeper.id) throw new Error("those are the same record");

// ── the safety gate ─────────────────────────────────────────────────────────
const daysOf = db.prepare(
  `SELECT DISTINCT ${cd("issueDate")} d FROM FuelIssue WHERE assetId = ? AND voided = 0`
);
const dl = new Set(daysOf.all(loser.id).map((r) => r.d));
const dk = new Set(daysOf.all(keeper.id).map((r) => r.d));
const clash = [...dl].filter((d) => dk.has(d));

// ── the second gate: one machine has one odometer ───────────────────────────
//
// An odometer counts up and never resets. Interleave both records' readings by
// date: if the combined series still climbs, they are plausibly one machine —
// LO-1580's 91,295.7 and 91,382.7 slot exactly between DT-72's 91,095.7 and
// 91,470.2. If it jumps backwards, or two readings on one day are thousands of
// kilometres apart, the records describe different vehicles and merging them
// would fuse two histories into a fiction.
const readingsOf = (id) =>
  db
    .prepare(
      `SELECT ${cd("readingDate")} d, value v, 'meter' src FROM MeterReading WHERE assetId = ?
       UNION ALL
       SELECT ${cd("issueDate")} d, meterReading v, 'fuel' src FROM FuelIssue
        WHERE assetId = ? AND voided = 0 AND meterReading IS NOT NULL`
    )
    .all(id, id);

const series = [
  ...readingsOf(loser.id).map((r) => ({ ...r, who: FROM })),
  ...readingsOf(keeper.id).map((r) => ({ ...r, who: INTO })),
].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

const meterBreaks = [];
for (let i = 1; i < series.length; i++) {
  const prev = series[i - 1];
  const cur = series[i];
  if (cur.v < prev.v) {
    meterBreaks.push(
      `${cur.d} ${cur.who}=${cur.v} is BELOW ${prev.d} ${prev.who}=${prev.v} (drop of ${(prev.v - cur.v).toLocaleString()})`
    );
  }
}
// Two readings on one day that differ by more than a day's plausible travel are
// two vehicles, even if the series happens to sort into ascending order.
const SAME_DAY_MAX = keeper.meterType === "KM" ? 1500 : 24;
for (let i = 1; i < series.length; i++) {
  const p = series[i - 1], c = series[i];
  if (p.d === c.d && Math.abs(c.v - p.v) > SAME_DAY_MAX) {
    meterBreaks.push(`${c.d}: two readings ${p.who}=${p.v} and ${c.who}=${c.v} differ by ${Math.abs(c.v - p.v).toLocaleString()} in one day`);
  }
}

// ── what moves ──────────────────────────────────────────────────────────────
const refs = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((t) => t.name)
  .filter((t) => db.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === "assetId"))
  .map((t) => ({
    table: t,
    moving: db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE assetId = ?`).get(loser.id).n,
    existing: db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE assetId = ?`).get(keeper.id).n,
  }))
  .filter((r) => r.moving || r.existing);

const litresOf = (id) =>
  db.prepare("SELECT COALESCE(SUM(litres),0) n FROM FuelIssue WHERE assetId = ? AND voided = 0").get(id).n;
const litresBefore = litresOf(loser.id) + litresOf(keeper.id);

const assigns = db
  .prepare(
    `SELECT aa.id, aa.assetId, aa.projectId, ${cd("aa.startDate")} s,
            CASE WHEN aa.endDate IS NULL THEN NULL ELSE ${cd("aa.endDate")} END e,
            aa.driverName, aa.billingType, p.name site
     FROM AssetAssignment aa JOIN Project p ON p.id = aa.projectId
     WHERE aa.assetId IN (?,?) ORDER BY aa.startDate`
  )
  .all(loser.id, keeper.id);

L(`\n════ MERGE ${FROM} → ${INTO}  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`  losing record   ${loser.code.padEnd(14)} ${loser.regNo || "—"}  ${loser.typeLabel || "—"}  ${loser.meterType}`);
L(`  surviving       ${keeper.code.padEnd(14)} ${keeper.regNo || "—"}  ${keeper.typeLabel || "—"}  ${keeper.meterType}`);
if (loser.meterType !== keeper.meterType) L(`  ⚠ meter types differ — check this is really one machine`);

L(`\n── references ──`);
for (const r of refs) L(`  ${r.table.padEnd(22)} moving ${String(r.moving).padStart(4)}   already on keeper ${String(r.existing).padStart(4)}`);

L(`\n── same-day fuel check ──`);
L(`  ${FROM} fuelled on ${dl.size} days, ${INTO} on ${dk.size} days`);
L(`  days both drew fuel: ${clash.length}${clash.length ? "  → " + clash.slice(0, 5).join(", ") : "  (none — consistent with one machine)"}`);
if (clash.length) {
  L(`\n✗ REFUSING: these records drew fuel on the same day, so they are two real machines.`);
  db.close();
  process.exit(1);
}

L(`\n── odometer / hour-meter check ──`);
if (series.length === 0) {
  L(`  neither record has a reading — nothing to contradict, but nothing to confirm either`);
} else {
  for (const r of series) L(`  ${r.d}  ${String(r.who).padEnd(11)} ${String(r.v).padStart(12)}  (${r.src})`);
  L(`  ${meterBreaks.length ? "" : "→ the combined series climbs throughout — consistent with one machine"}`);
}
if (meterBreaks.length) {
  L(`\n✗ REFUSING: the combined meter history is impossible for a single machine:`);
  for (const b of meterBreaks) L(`     ${b}`);
  L(`\n  These are different vehicles, or one of the records is itself a conflation.`);
  L(`  Merging would fuse two real histories into a reading that never happened.`);
  db.close();
  process.exit(1);
}

L(`\n── site attachments ──`);
for (const a of assigns) L(`  ${(a.assetId === loser.id ? FROM : INTO).padEnd(11)} ${a.s} .. ${(a.e || "open").padEnd(12)} ${(a.billingType || "—").padEnd(5)} ${a.site}`);
const sites = new Set(assigns.map((a) => a.projectId));
const earliest = assigns.length ? assigns[0].s : null;
if (sites.size === 1 && assigns.length > 1) {
  L(`  → collapsing to one presence at ${assigns[0].site} from ${earliest}`);
} else if (sites.size > 1) {
  L(`  → different sites; the loser's attachments are re-pointed and left for the fuel-driven rebuild`);
}

if (!APPLY) {
  L(`\n(DRY-RUN) nothing written — re-run with --apply.`);
  db.close();
  process.exit(0);
}

const out = db.transaction(() => {
  let moved = 0;
  for (const r of refs) {
    if (r.table === "AssetAssignment" || r.table === "RentalRate" || !r.moving) continue;
    moved += db.prepare(`UPDATE "${r.table}" SET assetId = ? WHERE assetId = ?`).run(keeper.id, loser.id).changes;
  }

  // Attachments: one site → one continuous presence from the earlier arrival.
  // Any other site keeps its own row, re-pointed at the survivor.
  if (sites.size === 1 && assigns.length > 1) {
    const keep = assigns.find((a) => a.assetId === keeper.id) || assigns[0];
    const openEnd = assigns.some((a) => a.e === null);
    const latestEnd = assigns.map((a) => a.e).filter(Boolean).sort().pop() || null;
    db.prepare("UPDATE AssetAssignment SET startDate = ?, endDate = ?, updatedAt = ? WHERE id = ?").run(
      atColombo(earliest),
      openEnd ? null : latestEnd ? atColombo(latestEnd) : null,
      NOW,
      keep.id
    );
    for (const a of assigns) if (a.id !== keep.id) db.prepare("DELETE FROM AssetAssignment WHERE id = ?").run(a.id);
    if (keep.assetId !== keeper.id) db.prepare("UPDATE AssetAssignment SET assetId = ? WHERE id = ?").run(keeper.id, keep.id);
  } else {
    db.prepare("UPDATE AssetAssignment SET assetId = ? WHERE assetId = ?").run(keeper.id, loser.id);
  }

  // A rate card belongs to the surviving record; the loser's would duplicate it.
  const loserRates = db.prepare("DELETE FROM RentalRate WHERE assetId = ?").run(loser.id).changes;

  if (OWNERSHIP) db.prepare("UPDATE Asset SET ownership = ?, updatedAt = ? WHERE id = ?").run(OWNERSHIP, NOW, keeper.id);

  const still = refs
    .map((r) => ({ t: r.table, n: db.prepare(`SELECT COUNT(*) n FROM "${r.table}" WHERE assetId = ?`).get(loser.id).n }))
    .filter((r) => r.n);
  if (still.length) throw new Error("references remain on the loser: " + JSON.stringify(still));
  db.prepare("DELETE FROM Asset WHERE id = ?").run(loser.id);

  const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
  db.prepare(
    `INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId) VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    crypto.randomUUID(), "UPDATE", "Asset", keeper.id,
    `Merged duplicate asset ${FROM} into ${INTO}. The two records were one machine whose registration was keyed differently on the fuel sheets — they never drew fuel on the same day and were only ever at the same site. Moved ${moved} record(s)${OWNERSHIP ? `; marked ownership ${OWNERSHIP}` : ""}.`,
    JSON.stringify({ from: FROM, into: INTO, fromId: loser.id, moved, loserRatesDeleted: loserRates, ownership: OWNERSHIP, earliestArrival: earliest }),
    NOW, admin ? admin.id : null
  );

  const litresAfter = litresOf(keeper.id);
  const overlaps = db.prepare(
    `SELECT COUNT(*) n FROM AssetAssignment a JOIN AssetAssignment b
       ON a.assetId=b.assetId AND a.id<>b.id
     WHERE a.startDate <= COALESCE(b.endDate,'9999') AND COALESCE(a.endDate,'9999') >= b.startDate
       AND a.assetId = ?`
  ).get(keeper.id).n;

  L(`\n── RECONCILIATION ──`);
  L(`  records moved                 ${moved}`);
  L(`  litres before / after         ${litresBefore} / ${litresAfter}   ${litresBefore === litresAfter ? "✓ unchanged" : "✗ MISMATCH"}`);
  L(`  ${INTO} in two places at once  ${overlaps}   (must be 0)`);
  L(`  ${FROM} still exists           ${db.prepare("SELECT COUNT(*) n FROM Asset WHERE code = ?").get(FROM).n}   (must be 0)`);
  if (litresBefore !== litresAfter || overlaps > 0) throw new Error("reconciliation failed — rolling back");
  return { moved, litresAfter };
})();

L(`\n✓ MERGED. ${out.moved} record(s) moved to ${INTO}, now holding ${out.litresAfter} L.`);
L(`  foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
db.close();
