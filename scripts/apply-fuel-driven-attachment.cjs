/**
 * Make fuel issues the single source of truth for where a vehicle is.
 *
 * Replaces AssetAssignment with attachments derived from fuel, under the rules
 * the owner set:
 *   - attached to a site from its FIRST fuel issue there
 *   - fuel gaps do NOT break the attachment
 *   - fuel at a DIFFERENT site closes the old one the day BEFORE the new site's
 *     first issue, so no day is left billed to nobody
 *   - returning to a previous site is a fresh attachment
 *   - no fuel ever = never attached = never billed
 *
 * WHAT IS CARRIED FORWARD: the Dry/Wet hire type and the driver from whatever
 * allocation covered the same days. Those are commercial decisions somebody
 * made and fuel records say nothing about them, so they are matched across by
 * overlap rather than discarded.
 *
 * WHAT IS LOST, DELIBERATELY: 69 vehicles that hold an allocation but have never
 * drawn fuel. Under the owner's rule they are not attached, so they stop being
 * billed. Only 8 of them currently bill anything (Rs 720,000 across Jul/Aug).
 * They are listed in full before anything is written.
 *
 *   node scripts/apply-fuel-driven-attachment.cjs            # dry run
 *   node scripts/apply-fuel-driven-attachment.cjs --apply
 */
const Database = require("better-sqlite3");

const DB = process.env.FUEL_DB || "data/app.db";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString().replace("Z", "+00:00");
const DAY = 86_400_000;

const db = new Database(DB);
db.pragma("foreign_keys = ON");
const L = (s = "") => console.log(s);
const pad = (v, n) => String(v ?? "").padEnd(n);
const cd = (e) => `date(datetime(${e},'+5 hours','+30 minutes'))`;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const atColombo = (d) => new Date(`${d}T00:00:00+05:30`).toISOString().replace("Z", "+00:00");
const dayOf = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
if (!admin) throw new Error("no admin user to attribute this to");

// ── build the attachments from fuel ──────────────────────────────────────────
const issues = db.prepare(`
  SELECT f.assetId, a.code, t.projectId, p.name AS site, ${cd("f.issueDate")} AS d
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  JOIN BulkTank t ON t.id = f.bulkTankId
  JOIN Project p ON p.id = t.projectId
  WHERE f.voided = 0
  ORDER BY f.assetId, f.issueDate`).all();

const byAsset = new Map();
for (const i of issues) {
  if (!byAsset.has(i.assetId)) byAsset.set(i.assetId, []);
  byAsset.get(i.assetId).push(i);
}

const attachments = [];
const sameDayFlips = [];   // drew at two sites on one day — the day goes to the later site
for (const [assetId, list] of byAsset) {
  const runs = [];
  for (const i of list) {
    const cur = runs[runs.length - 1];
    if (cur && cur.projectId === i.projectId) { cur.lastIssue = i.d; cur.n++; }
    else runs.push({ assetId, code: i.code, projectId: i.projectId, site: i.site, start: i.d, lastIssue: i.d, n: 1 });
  }
  for (let k = 0; k < runs.length; k++) {
    const next = runs[k + 1];
    runs[k].end = next ? addDays(next.start, -1) : null;
  }
  // A vehicle that drew at two sites on the SAME DAY leaves the earlier site
  // with an end before its start — a zero-length attachment. The day cannot
  // belong to both, so it goes to the site it moved to, and the vanishing
  // attachment is reported rather than written. Its fuel issue is untouched.
  for (const r of runs) {
    if (r.end !== null && r.end < r.start) { r.sameDayFlip = true; sameDayFlips.push(r); }
    else attachments.push(r);
  }
}

// ── carry the hire type and driver across from the current allocations ───────
const current = db.prepare(`
  SELECT assetId, projectId, ${cd("startDate")} AS s,
         CASE WHEN endDate IS NULL THEN NULL ELSE ${cd("endDate")} END AS e,
         driverName, billingType
  FROM AssetAssignment`).all();

let carried = 0;
for (const a of attachments) {
  // Prefer an allocation for the same site whose days overlap; else any overlap.
  const overlaps = current.filter((c) =>
    c.assetId === a.assetId &&
    c.s <= (a.end ?? "9999-12-31") &&
    (c.e ?? "9999-12-31") >= a.start);
  const best = overlaps.find((c) => c.projectId === a.projectId) ?? overlaps[0];
  if (best && (best.driverName || best.billingType)) {
    a.driverName = best.driverName;
    a.billingType = best.billingType;
    carried++;
  }
}

// ── what disappears ──────────────────────────────────────────────────────────
const fuelled = new Set(byAsset.keys());
const losing = db.prepare(`
  SELECT DISTINCT a.id, a.code, a.status FROM AssetAssignment aa JOIN Asset a ON a.id = aa.assetId`)
  .all().filter((r) => !fuelled.has(r.id));
const gaining = [...fuelled].filter((id) => !current.some((c) => c.assetId === id));

L(`\n════ FUEL-DRIVEN ATTACHMENT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`  fuel issues read              ${issues.length}`);
L(`  allocations today             ${current.length}  across ${new Set(current.map((c) => c.assetId)).size} vehicles`);
L(`  attachments from fuel         ${attachments.length}  across ${byAsset.size} vehicles`);
L(`  hire type / driver carried    ${carried}`);
L(`  same-day site flips dropped   ${sameDayFlips.length}  (drew at two sites on one day — the day goes to the site it moved to)`);
L(`\n  vehicles GAINING attachment   ${gaining.length}  (have fuel, no allocation today)`);
L(`  vehicles LOSING attachment    ${losing.length}  (allocated, never drew fuel)`);
for (const r of losing.slice(0, 20)) L(`     ${pad(r.code, 12)} ${r.status}`);
if (losing.length > 20) L(`     … ${losing.length - 20} more`);

if (!APPLY) { L(`\n(DRY-RUN) nothing written — re-run with --apply.`); db.close(); process.exit(0); }

const out = db.transaction(() => {
  const before = db.prepare("SELECT COUNT(*) n FROM AssetAssignment").get().n;

  // Only the fuel-derived postings are rebuilt. A MANUAL posting is somebody's
  // decision — most often the only way a machine that never draws diesel gets
  // billed at all — and this script used to delete every row, so every hand-made
  // correction survived exactly until the next run.
  const manual = db.prepare(`
    SELECT aa.assetId, aa.projectId, ${cd("aa.startDate")} s,
           CASE WHEN aa.endDate IS NULL THEN NULL ELSE ${cd("aa.endDate")} END e
    FROM AssetAssignment aa WHERE aa.origin = 'MANUAL'`).all();
  const manualBy = new Map();
  for (const m of manual) {
    if (!manualBy.has(m.assetId)) manualBy.set(m.assetId, []);
    manualBy.get(m.assetId).push(m);
  }
  db.prepare("DELETE FROM AssetAssignment WHERE origin = 'FUEL'").run();

  const ins = db.prepare(`INSERT INTO AssetAssignment
    (id, assetId, projectId, startDate, endDate, note, driverName, billingType, origin, createdAt, updatedAt, createdById)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let clipped = 0, dropped = 0;
  for (const a of attachments) {
    // Fuel still wins over a stale manual posting — diesel coming out of another
    // site's tank proves the machine moved — but where a MANUAL span covers the
    // same days at the SAME site there is nothing to add, and where it covers a
    // different site the fuel span is trimmed clear of it rather than overlapping.
    let start = a.start, end = a.end;
    const mine = manualBy.get(a.assetId) ?? [];
    let skip = false;
    for (const m of mine) {
      const mEnd = m.e ?? "9999-12-31";
      const aEnd = end ?? "9999-12-31";
      if (m.s > aEnd || mEnd < start) continue;           // no overlap
      if (m.projectId === a.projectId) { skip = true; break; } // already stated by hand
      if (m.s <= start && mEnd >= aEnd) { skip = true; break; } // fully covered by a manual span
      if (m.s > start) { end = addDays(m.s, -1); clipped++; }   // trim back before it
      else { start = addDays(mEnd, 1); clipped++; }             // or start after it
    }
    if (skip || (end !== null && end < start)) { dropped++; continue; }
    ins.run(crypto.randomUUID(), a.assetId, a.projectId,
      atColombo(start), end ? atColombo(end) : null,
      `Attached from fuel — first issue ${a.start}${end ? `, closed the day before the next site` : ", still active"}`,
      a.driverName ?? null, a.billingType ?? null, "FUEL", NOW, NOW, admin.id);
  }
  if (manual.length) L(`\n  manual postings preserved     ${manual.length}   (fuel spans clipped around them: ${clipped}, dropped as already covered: ${dropped})`);

  db.prepare(`INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), "UPDATE", "AssetAssignment", null,
    `Site attachment is now driven entirely by fuel issues, as the owner specified: attached from the first issue at a site, fuel gaps do not break it, and fuel at another site closes the old one the day before. Replaced ${before} allocations with ${attachments.length} attachments across ${byAsset.size} vehicles. ${gaining.length} vehicles gained an attachment they never had; ${losing.length} that have never drawn fuel lost theirs and will no longer be billed.`,
    JSON.stringify({ before, after: attachments.length, vehicles: byAsset.size,
      gained: gaining.length, lost: losing.map((r) => r.code), carriedHireType: carried }),
    NOW, admin.id);

  // ── reconciliation ─────────────────────────────────────────────────────────
  const overlap = db.prepare(`
    SELECT COUNT(*) n FROM AssetAssignment a JOIN AssetAssignment b
      ON a.assetId = b.assetId AND a.id <> b.id
    WHERE a.startDate <= COALESCE(b.endDate,'9999') AND COALESCE(a.endDate,'9999') >= b.startDate`).get().n;
  const backwards = db.prepare(`SELECT COUNT(*) n FROM AssetAssignment
    WHERE endDate IS NOT NULL AND endDate < startDate`).get().n;
  L(`\n── RECONCILIATION ──`);
  L(`  attachments now                    ${db.prepare("SELECT COUNT(*) n FROM AssetAssignment").get().n}   (was ${before})`);
  L(`  a vehicle in two places at once    ${overlap}   (must be 0)`);
  L(`  end before start                   ${backwards}   (must be 0)`);
  if (overlap > 0 || backwards > 0) throw new Error("reconciliation failed — refusing to commit");
  return { before, after: attachments.length };
})();

L(`\n✓ APPLIED. ${out.before} allocations replaced by ${out.after} fuel-driven attachments.`);
L(`  foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
db.close();
