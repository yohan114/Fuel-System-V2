/**
 * Import the legacy Service Record system's job history into ServiceRecord.
 *
 * SOURCE: servicerecord-DATA-*.tar.gz -> data/service.db  (SQLite)
 *   ServiceJobs   1604 jobs, Feb 2023 - Jul 2026
 *   ServiceOils   oil lines per job
 *   ServiceFilters filter lines per job
 *   Vehicles      the old system's machine register (ECNumber ~ Asset.code)
 *
 * WHY THIS MATTERS BEYOND HISTORY: computeServiceStatus() anchors "used since
 * last service" on the most recent ServiceRecord. With one record in the whole
 * table, every machine anchored to its commissioning date instead, so
 * "hours since service" was really "hours since the machine existed" and the
 * whole service planner read as overdue. These records are the anchors.
 *
 * METER READINGS ARE NOT ALL NUMBERS. 452 of 1604 jobs carry text where the
 * meter should be - "MNW"/"M.N.R"/"NW" all mean meter not working, plus 224
 * blanks. Those are stored as NULL, never as 0: a 0 would read as a real meter
 * reading and make the machine look freshly serviced at zero hours. The
 * original text is preserved in the note so the workshop can see why.
 *
 * Re-runnable: every row carries sourceRef "SRDB:<ServiceID>", which is unique,
 * so a second run updates in place rather than duplicating.
 *
 *   node scripts/import-service-records.cjs            # dry run
 *   node scripts/import-service-records.cjs --apply
 */
const Database = require("better-sqlite3");
const path = require("path");

const SRC = process.env.SERVICE_DB || ".import/servicerec/data/service.db";
const DST = process.env.FUEL_DB || "data/app.db";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString().replace("Z", "+00:00");
const SOURCE_LABEL = "Legacy Service Record system (servicerecord DATA 2026-08-10)";

const src = new Database(SRC, { readonly: true });
const db = new Database(DST);
db.pragma("foreign_keys = ON");

const L = (s = "") => console.log(s);
const pad = (v, n) => String(v ?? "").padEnd(n);
const norm = (s) => String(s ?? "").replace(/[-\s/().]/g, "").toUpperCase();
const cents = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) : null);

// Colombo midnight, matching how every other date in this system is stored.
const colombo = (d) => new Date(`${d}T00:00:00+05:30`).toISOString().replace("Z", "+00:00");

// A meter cell is only a reading when it is actually a number. "MNW" (meter not
// working), "M.N.R", "NW", "0HRS" and blanks are not.
const meterVal = (v) => {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (!/\d/.test(raw)) return null;             // pure text: MNW, NW, N, NO ...
  if (/^0+(\s*hrs?)?$/i.test(raw)) return null; // "0" / "0HRS" is not a reading
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const meterNote = (v) => {
  const raw = String(v ?? "").trim();
  return raw && meterVal(v) == null ? raw : null;
};

// ── asset resolution ────────────────────────────────────────────────────────
const byCode = new Map(), byReg = new Map();
for (const a of db.prepare("SELECT id, code, regNo, meterType, status FROM Asset").all()) {
  if (a.code && !byCode.has(norm(a.code))) byCode.set(norm(a.code), a);
  if (a.regNo && !byReg.has(norm(a.regNo))) byReg.set(norm(a.regNo), a);
}
const look = (k) => byCode.get(k) || byReg.get(k) || null;
// "VR-059" -> "VR-59": the old system zero-pads some numeric suffixes.
const dezero = (s) => {
  const m = String(s).match(/^([A-Za-z]+)-?0*(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : null;
};
const fromLabel = (lab) => {
  if (!lab) return null;
  const s = String(lab).trim();
  const whole = look(norm(s));
  if (whole) return whole;
  // Labels carry trailing notes: "PD-7049 solution", "GE-48 yanmar AG45SS".
  for (const tok of s.split(/[\s(),]+/).filter(Boolean)) {
    const hit = look(norm(tok));
    if (hit) return hit;
    const dz = dezero(tok);
    if (dz && look(norm(dz))) return look(norm(dz));
  }
  return null;
};
const vehicles = new Map(src.prepare("SELECT * FROM Vehicles").all().map((v) => [v.VehicleID, v]));
const resolveAsset = (job) => {
  const v = vehicles.get(job.VehicleID);
  if (v) {
    const hit = look(norm(v.ECNumber)) || look(norm(v.RegistrationNo));
    if (hit) return { asset: hit, how: "vehicle" };
  }
  const byLab = fromLabel(job.VehicleLabel);
  if (byLab) return { asset: byLab, how: "label" };
  return { asset: null, how: "none" };
};

// ── plan ────────────────────────────────────────────────────────────────────
const jobs = src.prepare("SELECT * FROM ServiceJobs ORDER BY ServiceDate, ServiceID").all();
const oilsBy = new Map(), filtersBy = new Map();
for (const o of src.prepare("SELECT * FROM ServiceOils").all())
  (oilsBy.get(o.ServiceID) ?? oilsBy.set(o.ServiceID, []).get(o.ServiceID)).push(o);
for (const f of src.prepare("SELECT * FROM ServiceFilters").all())
  (filtersBy.get(f.ServiceID) ?? filtersBy.set(f.ServiceID, []).get(f.ServiceID)).push(f);

const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
if (!admin) throw new Error("no admin user to attribute the import to");

const plan = [], unresolved = [], badDate = [];
for (const j of jobs) {
  if (!j.ServiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(j.ServiceDate).trim())) { badDate.push(j); continue; }
  const { asset, how } = resolveAsset(j);
  if (!asset) { unresolved.push(j); continue; }
  plan.push({ job: j, asset, how, meter: meterVal(j.MeterReading), mNote: meterNote(j.MeterReading),
              next: meterVal(j.NextServiceMeter) });
}

const existing = new Set(
  db.prepare("SELECT sourceRef FROM ServiceRecord WHERE sourceRef LIKE 'SRDB:%'").all().map((r) => r.sourceRef)
);
const toInsert = plan.filter((p) => !existing.has(`SRDB:${p.job.ServiceID}`));
const toUpdate = plan.filter((p) => existing.has(`SRDB:${p.job.ServiceID}`));

L(`\n════ SERVICE RECORD IMPORT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`Source : ${path.resolve(SRC)}`);
L(`Target : ${path.resolve(DST)}  ->  ServiceRecord + ServiceItem`);
L(`\n── MATCHING ──`);
L(`  jobs in source            ${jobs.length}`);
L(`  matched to a machine      ${plan.length}   (via vehicle ${plan.filter((p) => p.how === "vehicle").length}, via label ${plan.filter((p) => p.how === "label").length})`);
L(`  unusable service date     ${badDate.length}`);
L(`  machine not in the system ${unresolved.length}`);
const unlbl = {};
for (const u of unresolved) { const k = String(u.VehicleLabel ?? "(blank)").trim() || "(blank)"; unlbl[k] = (unlbl[k] || 0) + 1; }
for (const [k, v] of Object.entries(unlbl).sort((a, b) => b[1] - a[1]))
  L(`     ${String(v).padStart(3)} x  ${k}`);

L(`\n── METER READINGS ──`);
L(`  numeric, stored as the meter at service  ${plan.filter((p) => p.meter != null).length}`);
L(`  not a reading, stored as NULL            ${plan.filter((p) => p.meter == null).length}`);
const notes = {};
for (const p of plan) if (p.mNote) notes[p.mNote.toUpperCase()] = (notes[p.mNote.toUpperCase()] || 0) + 1;
L(`     of which text (kept in the note): ${JSON.stringify(Object.entries(notes).sort((a, b) => b[1] - a[1]).slice(0, 6))}`);

L(`\n── WRITES ──`);
L(`  new records     ${toInsert.length}`);
L(`  already present ${toUpdate.length}  (re-run updates in place)`);
L(`  oil lines       ${plan.reduce((n, p) => n + (oilsBy.get(p.job.ServiceID)?.length ?? 0), 0)}`);
L(`  filter lines    ${plan.reduce((n, p) => n + (filtersBy.get(p.job.ServiceID)?.length ?? 0), 0)}`);
L(`  machines gaining a service history: ${new Set(plan.map((p) => p.asset.id)).size}`);

if (!APPLY) { L(`\n(DRY-RUN) nothing written — re-run with --apply.`); src.close(); db.close(); process.exit(0); }

// ── write ───────────────────────────────────────────────────────────────────
const insRec = db.prepare(`INSERT INTO ServiceRecord
  (id, assetId, serviceDate, meterAtService, meterType, serviceType, costCents, note, jobNo,
   partsCents, labourCents, sundryCents, sourceRef, location, nextServiceMeter, recordedById, createdAt)
  VALUES (@id,@assetId,@serviceDate,@meterAtService,@meterType,@serviceType,@costCents,@note,@jobNo,
          @partsCents,@labourCents,@sundryCents,@sourceRef,@location,@nextServiceMeter,@recordedById,@createdAt)`);
const updRec = db.prepare(`UPDATE ServiceRecord SET
   assetId=@assetId, serviceDate=@serviceDate, meterAtService=@meterAtService, meterType=@meterType,
   serviceType=@serviceType, costCents=@costCents, note=@note, jobNo=@jobNo, partsCents=@partsCents,
   labourCents=@labourCents, sundryCents=@sundryCents, location=@location, nextServiceMeter=@nextServiceMeter
   WHERE sourceRef=@sourceRef`);
const getId = db.prepare("SELECT id FROM ServiceRecord WHERE sourceRef=?");
const delItems = db.prepare("DELETE FROM ServiceItem WHERE serviceRecordId=?");
const insItem = db.prepare(`INSERT INTO ServiceItem
  (id, serviceRecordId, kind, description, partNo, action, qty, unitPriceCents, amountCents)
  VALUES (@id,@rec,@kind,@description,@partNo,@action,@qty,@unitPriceCents,@amountCents)`);

const out = db.transaction(() => {
  let ins = 0, upd = 0, items = 0;
  for (const p of plan) {
    const j = p.job;
    const sourceRef = `SRDB:${j.ServiceID}`;
    const noteParts = [];
    if (j.RepairDetails && j.RepairDetails.trim()) noteParts.push(j.RepairDetails.trim());
    if (p.mNote) noteParts.push(`Meter at service recorded as "${p.mNote}" — not a usable reading.`);
    if (p.how === "label") noteParts.push(`Matched from the old system's label "${j.VehicleLabel}".`);
    const row = {
      id: crypto.randomUUID(),
      assetId: p.asset.id,
      serviceDate: colombo(String(j.ServiceDate).trim()),
      meterAtService: p.meter,
      meterType: p.asset.meterType,
      serviceType: j.ServiceType ? String(j.ServiceType).trim() || null : null,
      costCents: cents(j.GrandTotal),
      note: noteParts.length ? noteParts.join(" ") : null,
      jobNo: j.JobNo ? String(j.JobNo).trim() || null : null,
      partsCents: cents(j.PartsSubtotal),
      labourCents: cents(j.LabourCharge),
      sundryCents: cents(j.SundryAmount),
      sourceRef,
      location: j.SiteLocation ? String(j.SiteLocation).trim() || null : null,
      nextServiceMeter: p.next,
      recordedById: admin.id,
      createdAt: NOW,
    };
    if (existing.has(sourceRef)) { updRec.run(row); upd++; } else { insRec.run(row); ins++; }

    const recId = getId.get(sourceRef).id;
    delItems.run(recId); // rebuild lines so a re-run is idempotent
    for (const o of oilsBy.get(j.ServiceID) ?? []) {
      insItem.run({ id: crypto.randomUUID(), rec: recId, kind: "OIL",
        description: String(o.OilName ?? o.OilType ?? "Oil").trim() || "Oil",
        partNo: o.OilType ? String(o.OilType).trim() || null : null,
        action: o.ActionType ? String(o.ActionType).trim() || null : null,
        qty: Number(o.Quantity) || 1, unitPriceCents: cents(o.Price),
        amountCents: cents((Number(o.Price) || 0) * (Number(o.Quantity) || 1)) });
      items++;
    }
    for (const f of filtersBy.get(j.ServiceID) ?? []) {
      insItem.run({ id: crypto.randomUUID(), rec: recId, kind: "FILTER",
        description: String(f.FilterCategory ?? "Filter").trim() || "Filter",
        partNo: f.FilterNo ? String(f.FilterNo).trim() || null : null,
        action: f.ActionType ? String(f.ActionType).trim() || null : null,
        qty: Number(f.Quantity) || 1, unitPriceCents: cents(f.Price),
        amountCents: cents((Number(f.Price) || 0) * (Number(f.Quantity) || 1)) });
      items++;
    }
  }

  db.prepare(`INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), "CREATE", "ServiceRecord", null,
    `Imported ${ins} service jobs (${upd} updated) from the legacy Service Record system, Feb 2023 – Jul 2026, across ${new Set(plan.map((p) => p.asset.id)).size} machines, with ${items} oil and filter lines. ${plan.filter((p) => p.meter == null).length} jobs had no usable meter reading and were stored without one. ${unresolved.length} jobs name machines that do not exist in the fuel system and were skipped.`,
    JSON.stringify({ source: SOURCE_LABEL, inserted: ins, updated: upd, items,
      machines: new Set(plan.map((p) => p.asset.id)).size,
      skippedNoMachine: unresolved.length, skippedBadDate: badDate.length,
      noMeter: plan.filter((p) => p.meter == null).length,
      unresolvedLabels: Object.keys(unlbl) }),
    NOW, admin.id);

  // reconciliation, inside the transaction
  const tot = db.prepare("SELECT COUNT(*) n FROM ServiceRecord WHERE sourceRef LIKE 'SRDB:%'").get().n;
  const zero = db.prepare("SELECT COUNT(*) n FROM ServiceRecord WHERE meterAtService = 0").get().n;
  const orphan = db.prepare(`SELECT COUNT(*) n FROM ServiceRecord r
                             LEFT JOIN Asset a ON a.id = r.assetId WHERE a.id IS NULL`).get().n;
  L(`\n── RECONCILIATION ──`);
  L(`  imported records now present  ${tot}   (expected ${plan.length})`);
  L(`  meterAtService = 0            ${zero}   (must be 0 — a zero would read as a real reading)`);
  L(`  records with no machine       ${orphan}   (must be 0)`);
  if (tot !== plan.length || zero > 0 || orphan > 0) throw new Error("reconciliation failed — refusing to commit");
  return { ins, upd, items };
})();

L(`\n✓ APPLIED. ${out.ins} inserted, ${out.upd} updated, ${out.items} part lines.`);
L(`  foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
src.close();
db.close();
