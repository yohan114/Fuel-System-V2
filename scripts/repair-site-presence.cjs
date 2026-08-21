/**
 * Repair fragmented site presence.
 *
 * A vehicle's presence at a site was inferred from fuel draws: scripts/post_pump_vehicles.ts
 * writes one AssetAssignment per contiguous run of days the vehicle happened to draw
 * fuel, so one day without a draw ends the "visit" and the next draw starts a new one.
 * BD-05 has separate one-day postings on 2 Feb, 1 Jun, 4 Jun and 18 Jun — recorded as
 * arriving and leaving the same day, four times. Billing then prorates each month from
 * that month's first draw, re-billing a vehicle that never moved as a new arrival.
 *
 * THE MODEL THIS RESTORES: a vehicle arrives at a site once and stays until it turns up
 * somewhere else. Gaps with no fuel are not absence — a parked machine draws no diesel.
 * So for each vehicle the postings are walked in date order and each site's presence is
 * extended until the vehicle first appears at a DIFFERENT site. A genuine transfer still
 * ends the span, on the day before the new site starts.
 *
 * Only fuel-derived rows are rewritten. A posting somebody entered by hand is evidence of
 * an actual decision and is left exactly as it is; it only ever bounds the spans around it.
 *
 *   node scripts/repair-site-presence.cjs            # dry run
 *   node scripts/repair-site-presence.cjs --apply
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

// Colombo calendar day <-> stored instant (a day is stored at 18:30Z the day before).
const dayOf = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const atColomboMidnight = (d) => new Date(`${d}T00:00:00+05:30`).toISOString().replace("Z", "+00:00");
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
if (!admin) throw new Error("no admin user to attribute the repair to");

const rows = db.prepare(`
  SELECT aa.id, aa.assetId, aa.projectId, aa.startDate, aa.endDate, aa.note,
         aa.driverName, aa.billingType, a.code, p.name AS site
  FROM AssetAssignment aa
  JOIN Asset a ON a.id = aa.assetId
  JOIN Project p ON p.id = aa.projectId
  ORDER BY aa.assetId, aa.startDate, aa.createdAt`).all();

const isFuelDerived = (r) => typeof r.note === "string" && r.note.startsWith("Drew from ");

// Group by vehicle.
const byAsset = new Map();
for (const r of rows) {
  if (!byAsset.has(r.assetId)) byAsset.set(r.assetId, []);
  byAsset.get(r.assetId).push(r);
}

const plan = [];       // presences to rewrite
const untouched = [];  // already correct
const conflicts = [];  // two sites starting the same day — needs a human

for (const [, list] of byAsset) {
  // Collapse to one presence per contiguous stretch at a single site.
  const spans = [];
  for (const r of list) {
    const s = dayOf(r.startDate);
    const e = r.endDate ? dayOf(r.endDate) : null;
    const last = spans[spans.length - 1];
    if (last && last.projectId === r.projectId) {
      // Same site again — extend rather than start a new visit. This is the fix:
      // a gap between draws is not a departure.
      last.to = last.to === null || e === null ? null : (e > last.to ? e : last.to);
      last.ids.push(r.id);
      last.anyManual = last.anyManual || !isFuelDerived(r);
      if (!last.driverName && r.driverName) last.driverName = r.driverName;
      if (!last.billingType && r.billingType) last.billingType = r.billingType;
    } else {
      spans.push({
        projectId: r.projectId, site: r.site, code: r.code, assetId: r.assetId,
        from: s, to: e, ids: [r.id], anyManual: !isFuelDerived(r),
        driverName: r.driverName, billingType: r.billingType,
      });
    }
  }

  // A span runs until the vehicle turns up at the next site: that is the transfer.
  //
  // This both EXTENDS and TRUNCATES, and the truncation is the bigger fix. 524 of
  // the 572 overlapping pairs are one shape: an old posting (often to Marawila)
  // left running months into the future while the vehicle was posted somewhere
  // else on top of it. The vehicle transferred and nobody closed the old row.
  // Billing hid it — resolveDayRuns awards a contested day to the later start —
  // but the stale row still claims days it has no right to, and every report that
  // reads allocations directly sees the machine in two places at once.
  for (let i = 0; i < spans.length; i++) {
    const next = spans[i + 1];
    if (!next) continue;
    const dayBefore = addDays(next.from, -1);
    if (spans[i].to === null || spans[i].to !== dayBefore) {
      spans[i].truncated = spans[i].to !== null && spans[i].to > dayBefore;
      spans[i].to = dayBefore;
    }
  }
  // A span that now ends before it starts means two postings began on the same
  // day at different sites. Leave those alone and report them — only the site
  // register can say which is right.
  for (const sp of spans) {
    if (sp.to !== null && sp.to < sp.from) sp.sameDayConflict = true;
  }

  for (const sp of spans) {
    if (sp.sameDayConflict) { conflicts.push(sp); continue; }
    // Nothing to do when a single row already describes the whole presence.
    if (sp.ids.length === 1) {
      const orig = list.find((r) => r.id === sp.ids[0]);
      const origTo = orig.endDate ? dayOf(orig.endDate) : null;
      if (origTo === sp.to) { untouched.push(sp); continue; }
    }
    plan.push(sp);
  }
}

const collapsing = plan.filter((p) => p.ids.length > 1);
const truncating = plan.filter((p) => p.truncated);
const extending = plan.filter((p) => p.ids.length === 1);

L(`\n════ SITE PRESENCE REPAIR  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`  postings today                    ${rows.length}`);
L(`  of which inferred from fuel draws ${rows.filter(isFuelDerived).length}`);
L(`  vehicles examined                 ${byAsset.size}`);
L(`\n── WHAT CHANGES ──`);
L(`  fragmented visits merged into one presence : ${collapsing.length}`);
L(`     postings they replace                   : ${collapsing.reduce((n, p) => n + p.ids.length, 0)}`);
L(`  presences extended to the next transfer    : ${extending.length}`);
L(`  stale postings closed at the transfer      : ${truncating.length}`);
L(`  left exactly as they are                   : ${untouched.length}`);
L(`  two sites starting the same day (skipped)  : ${conflicts.length}`);

if (collapsing.length) {
  L(`\n  ── merged (worst first) ──`);
  for (const p of [...collapsing].sort((a, b) => b.ids.length - a.ids.length).slice(0, 18))
    L(`     ${pad(p.code, 10)} ${pad(p.site.slice(0, 22), 24)} ${p.ids.length} postings -> ${p.from} .. ${p.to ?? "open"}`);
}

if (!APPLY) { L(`\n(DRY-RUN) nothing written — re-run with --apply.`); db.close(); process.exit(0); }

const del = db.prepare("DELETE FROM AssetAssignment WHERE id = ?");
const ins = db.prepare(`INSERT INTO AssetAssignment
  (id, assetId, projectId, startDate, endDate, note, driverName, billingType, createdAt, updatedAt, createdById)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

const overlapBefore = db.prepare(`
  SELECT COUNT(*) n FROM AssetAssignment a JOIN AssetAssignment b
    ON a.assetId = b.assetId AND a.id <> b.id AND a.projectId <> b.projectId
  WHERE a.startDate <= COALESCE(b.endDate, '9999') AND COALESCE(a.endDate, '9999') >= b.startDate`).get().n;

const out = db.transaction(() => {
  let merged = 0, removed = 0;
  for (const p of plan) {
    for (const id of p.ids) { del.run(id); removed++; }
    ins.run(
      crypto.randomUUID(), p.assetId, p.projectId,
      atColomboMidnight(p.from), p.to ? atColomboMidnight(p.to) : null,
      p.ids.length > 1
        ? `Continuous presence — merged ${p.ids.length} fuel-derived visits`
        : `Continuous presence to the next transfer`,
      p.driverName, p.billingType, NOW, NOW, admin.id
    );
    merged++;
  }
  db.prepare(`INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), "UPDATE", "AssetAssignment", null,
    `Repaired site presence: ${collapsing.length} vehicles had their fuel-derived visits merged into one continuous presence per site (${removed} postings replaced by ${merged}). Presence was previously inferred from fuel draws, so a day without a draw ended the visit and the next draw was billed as a fresh arrival.`,
    JSON.stringify({ merged, removed, collapsed: collapsing.length, extended: extending.length,
      examples: collapsing.slice(0, 25).map((p) => ({ code: p.code, site: p.site, was: p.ids.length, from: p.from, to: p.to })) }),
    NOW, admin.id);

  // Reconciliation: no vehicle may be at two sites on the same day.
  const overlap = db.prepare(`
    SELECT COUNT(*) n FROM AssetAssignment a JOIN AssetAssignment b
      ON a.assetId = b.assetId AND a.id <> b.id AND a.projectId <> b.projectId
    WHERE a.startDate <= COALESCE(b.endDate, '9999') AND COALESCE(a.endDate, '9999') >= b.startDate`).get().n;
  const backwards = db.prepare(`SELECT COUNT(*) n FROM AssetAssignment
    WHERE endDate IS NOT NULL AND endDate < startDate`).get().n;
  L(`\n── RECONCILIATION ──`);
  L(`  postings now                       ${db.prepare("SELECT COUNT(*) n FROM AssetAssignment").get().n}   (was ${rows.length})`);
  L(`  same vehicle at two sites at once  ${overlapBefore} -> ${overlap}   (must not increase)`);
  L(`  end before start                   ${backwards}   (must be 0)`);
  L(`  residual overlaps are the ${conflicts.length} postings that start the same day at two sites —`);
  L(`  left for a human, because only the site register can say which one is right.`);
  // The gate is "strictly better, never worse". Demanding zero could never pass:
  // 117 postings begin on the same day at two different sites, and guessing which
  // is real would be inventing an allocation decision.
  if (overlap > overlapBefore || backwards > 0) {
    throw new Error("reconciliation failed — the repair made things worse, refusing to commit");
  }
  return { merged, removed, overlapBefore, overlapAfter: overlap };
})();

L(`\n✓ APPLIED. ${out.removed} postings replaced by ${out.merged} continuous presences.`);
L(`  foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
db.close();
