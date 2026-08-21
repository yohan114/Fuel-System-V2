/**
 * Site-wise fleet billing, driven entirely by fuel issues.
 *
 * A unit is attached to a site from its FIRST fuel issue there, stays attached
 * through fuel gaps, and detaches only when fuel appears at a DIFFERENT site.
 * No fuel ever = never attached = never billed.
 *
 * TRANSFER CONVENTION (the spec asked which is used):
 *   the old site closes on the DAY BEFORE the first fuel issue at the new site.
 * Not "the last fuel issue at the old site". The two differ whenever there is a
 * gap between leaving and arriving, and closing on the day before the new
 * arrival is the only convention where the days always add up to the month —
 * the other leaves the in-between days billed to nobody. LB-21 shows it: last
 * draw at CEP-03 E on 8 May, first at Galagedara on 11 May. Closing on 8 May
 * loses the 9th and 10th; closing on 10 May does not.
 *
 * SITE OF A FUEL ISSUE: the site that owns the pump the fuel came out of
 * (BulkTank -> Project). Every one of the 13,137 non-voided issues has one.
 *
 * MONTHLY HIRE RATE: no monthly column exists on the rate card, so it is derived
 * from the contractual monthly minimum the owner confirmed —
 *   hourly machines  hourly rate x 120 hours
 *   road vehicles    per-km rate x 3,000 km
 *   day-hire plant   daily rate x 26 days
 * The basis used (wet / fuel+wet / dry) is named on every row.
 *
 *   node scripts/site-wise-fuel-billing.cjs
 */
const Database = require("better-sqlite3");
const XLSX = require("xlsx");

const DB = process.env.FUEL_DB || "data/app.db";
const OUT = process.env.OUT || "D:/Yohan/Report/Site_Wise_Fuel_Billing.xlsx";
const DAY = 86_400_000;

const db = new Database(DB, { readonly: true });
const L = (s = "") => console.log(s);
const cd = (e) => `date(datetime(${e},'+5 hours','+30 minutes'))`;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
const monthOf = (d) => d.slice(0, 7);
const lastDayOf = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
};
const daysInMonth = (m) => Number(lastDayOf(m).slice(8));
const rs = (c) => Math.round(c) / 100;

// ── the monthly hire rate, derived from the contractual minimum ──────────────
function monthlyRate(r) {
  if (!r) return { cents: 0, basis: "—", how: "no rate card" };
  const pick = (fw, w, d) =>
    w != null ? { v: w, b: "wet" } : fw != null ? { v: fw, b: "fuel+wet" } : d != null ? { v: d, b: "dry" } : null;
  const hr = pick(r.hrFwCents, r.hrWCents, r.hrDCents);
  const km = pick(r.kmFwCents, r.kmWCents, r.kmDCents);
  const dy = pick(r.dyFwCents, r.dyWCents, r.dyDCents);
  if (hr) return { cents: hr.v * 120, basis: hr.b, how: `${rs(hr.v)}/hr x 120 h` };
  if (km) return { cents: km.v * 3000, basis: km.b, how: `${rs(km.v)}/km x 3,000 km` };
  if (dy) return { cents: dy.v * 26, basis: dy.b, how: `${rs(dy.v)}/day x 26 days` };
  return { cents: 0, basis: "—", how: "rate card has no usable tier" };
}

// ── every fuel issue with the site of the pump it came from ──────────────────
const issues = db.prepare(`
  SELECT a.code AS vehicle, COALESCE(a.regNo,'') AS regNo, COALESCE(c.name,'') AS category,
         p.name AS site, ${cd("f.issueDate")} AS d, f.litres
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  LEFT JOIN Category c ON c.id = a.categoryId
  JOIN BulkTank t ON t.id = f.bulkTankId
  JOIN Project p ON p.id = t.projectId
  WHERE f.voided = 0
  ORDER BY a.code, f.issueDate`).all();

const rates = new Map(db.prepare(`
  SELECT a.code, r.hrFwCents, r.hrWCents, r.hrDCents, r.kmFwCents, r.kmWCents, r.kmDCents,
         r.dyFwCents, r.dyWCents, r.dyDCents
  FROM RentalRate r JOIN Asset a ON a.id = r.assetId`).all().map((r) => [r.code, r]));

// ── attachments: a new site starts one, a gap does not end one ───────────────
const byVehicle = new Map();
for (const i of issues) {
  if (!byVehicle.has(i.vehicle)) byVehicle.set(i.vehicle, []);
  byVehicle.get(i.vehicle).push(i);
}

const attachments = []; // { vehicle, regNo, category, site, start, end|null, days, status }
const transfers = [];
const alternating = [];

for (const [vehicle, list] of byVehicle) {
  const runs = [];
  for (const i of list) {
    const cur = runs[runs.length - 1];
    if (cur && cur.site === i.site) { cur.lastIssue = i.d; cur.issues++; cur.litres += i.litres; }
    else runs.push({ site: i.site, start: i.d, lastIssue: i.d, issues: 1, litres: i.litres,
                     regNo: i.regNo, category: i.category });
  }
  // Close each run the day before the next site's first issue.
  for (let k = 0; k < runs.length; k++) {
    const next = runs[k + 1];
    runs[k].end = next ? addDays(next.start, -1) : null;
    runs[k].status = next ? "Transferred" : "Active";
    if (next) {
      transfers.push({
        vehicle, from: runs[k].site, to: next.site,
        lastIssueAtOldSite: runs[k].lastIssue,
        oldSiteClosed: runs[k].end,
        firstIssueAtNewSite: next.start,
        gapDays: daysBetween(runs[k].lastIssue, next.start) - 1,
      });
    }
  }
  // A unit whose fuel bounces between two sites inside one month cannot be
  // attributed safely — the fuel alone does not say where it was working.
  const monthsWithFlips = new Map();
  for (let k = 1; k < runs.length; k++) {
    const m = monthOf(runs[k].start);
    if (monthOf(runs[k - 1].start) === m || monthOf(runs[k - 1].end ?? runs[k - 1].lastIssue) === m)
      monthsWithFlips.set(m, (monthsWithFlips.get(m) ?? 0) + 1);
  }
  for (const [m, n] of monthsWithFlips) {
    if (n >= 2) alternating.push({ vehicle, month: m, changes: n + 1,
      sites: [...new Set(runs.filter((r) => monthOf(r.start) === m).map((r) => r.site))].join(" / ") });
  }
  for (const r of runs) {
    attachments.push({
      vehicle, regNo: r.regNo, category: r.category, site: r.site,
      start: r.start, end: r.end, lastIssue: r.lastIssue,
      days: r.end ? daysBetween(r.start, r.end) : null,
      issues: r.issues, litres: Math.round(r.litres * 10) / 10, status: r.status,
    });
  }
}

// ── monthly billing: one row per vehicle-site-month ──────────────────────────
const today = db.prepare(`SELECT MAX(${cd("issueDate")}) d FROM FuelIssue WHERE voided = 0`).get().d;
const billing = [];
for (const a of attachments) {
  const finish = a.end ?? today; // an open attachment bills to the latest data we hold
  let m = monthOf(a.start);
  while (m <= monthOf(finish)) {
    const mStart = `${m}-01`, mEnd = lastDayOf(m);
    const from = a.start > mStart ? a.start : mStart;
    const to = finish < mEnd ? finish : mEnd;
    if (from <= to) {
      const dim = daysInMonth(m);
      const billed = daysBetween(from, to);
      const rate = monthlyRate(rates.get(a.vehicle));
      const full = rate.cents;
      const prorated = billed === dim ? full : Math.round((full / dim) * billed);
      const litres = issues.filter((i) => i.vehicle === a.vehicle && i.site === a.site && i.d >= from && i.d <= to);
      billing.push({
        Month: m, Site: a.site, Vehicle: a.vehicle, "Vehicle No": a.regNo, Category: a.category,
        "Billing From": from, "Billing To": to, "Days Billed": billed, "Days In Month": dim,
        "Full Month": billed === dim ? "Yes" : "No",
        "Monthly Rate (Rs)": rs(full), "Rate Basis": rate.basis, "Rate Derived From": rate.how,
        "Pro-rated Amount (Rs)": rs(prorated), "Full Month Amount (Rs)": rs(full),
        "Fuel Issues": litres.length, "Litres": Math.round(litres.reduce((s, x) => s + x.litres, 0) * 10) / 10,
        Status: a.status,
      });
    }
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
}

// ── cross-check: a unit can never be billed more days than the month holds ───
const perVehicleMonth = new Map();
for (const b of billing) {
  const k = `${b.Vehicle}|${b.Month}`;
  perVehicleMonth.set(k, (perVehicleMonth.get(k) ?? 0) + b["Days Billed"]);
}
const overruns = [...perVehicleMonth].filter(([k, d]) => d > daysInMonth(k.split("|")[1]));

// ── site summary: months across, sites down ──────────────────────────────────
const months = [...new Set(billing.map((b) => b.Month))].sort();
const sites = [...new Set(billing.map((b) => b.Site))].sort();
const summary = sites.map((s) => {
  const row = { Site: s };
  let total = 0;
  for (const m of months) {
    const v = billing.filter((b) => b.Site === s && b.Month === m).reduce((n, b) => n + b["Pro-rated Amount (Rs)"], 0);
    row[m] = Math.round(v);
    total += v;
  }
  row["TOTAL"] = Math.round(total);
  return row;
});
const totalRow = { Site: "ALL SITES" };
for (const m of months) totalRow[m] = Math.round(summary.reduce((n, r) => n + r[m], 0));
totalRow["TOTAL"] = Math.round(summary.reduce((n, r) => n + r["TOTAL"], 0));
summary.push(totalRow);

// ── write ────────────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
const add = (name, rows, cols) => {
  const s = XLSX.utils.json_to_sheet(rows);
  if (cols) s["!cols"] = cols.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, s, name);
};

add("1 Attachment Register", attachments.map((a) => ({
  Vehicle: a.vehicle, "Vehicle No": a.regNo, Category: a.category, Site: a.site,
  "Start Date": a.start, "End Date": a.end ?? "", Days: a.days ?? "",
  "Last Fuel Issue": a.lastIssue, "Fuel Issues": a.issues, Litres: a.litres, Status: a.status,
})), [12, 12, 20, 26, 12, 12, 7, 14, 11, 9, 12]);

add("2 Monthly Billing", billing.sort((a, b) =>
  a.Month.localeCompare(b.Month) || a.Site.localeCompare(b.Site) || a.Vehicle.localeCompare(b.Vehicle)),
  [9, 26, 11, 12, 18, 12, 12, 10, 12, 10, 16, 10, 20, 20, 20, 10, 9, 12]);

add("3 Site Summary", summary, [26, ...months.map(() => 12), 14]);

add("4 Transfer Log", transfers.sort((a, b) => a.firstIssueAtNewSite.localeCompare(b.firstIssueAtNewSite)).map((t) => ({
  Vehicle: t.vehicle, "From Site": t.from, "To Site": t.to,
  "Last Issue at Old Site": t.lastIssueAtOldSite,
  "Old Site Closed": t.oldSiteClosed,
  "First Issue at New Site": t.firstIssueAtNewSite,
  "Idle Days Between": t.gapDays,
})), [12, 26, 26, 20, 16, 20, 16]);

if (alternating.length) {
  add("5 Needs Confirmation", alternating.sort((a, b) => b.changes - a.changes).map((a) => ({
    Vehicle: a.vehicle, Month: a.month, "Site Changes In Month": a.changes, Sites: a.sites,
    Why: "Fuel alternates between sites inside one month — confirm where it actually worked before billing",
  })), [12, 9, 20, 40, 70]);
}

XLSX.writeFile(wb, OUT);

L(`\n════ SITE-WISE FUEL-DRIVEN BILLING ════`);
L(`  fuel issues read (non-voided) : ${issues.length}`);
L(`  vehicles with any fuel        : ${byVehicle.size}`);
L(`  attachments identified        : ${attachments.length}   (${attachments.filter((a) => a.status === "Active").length} active, ${attachments.filter((a) => a.status === "Transferred").length} transferred)`);
L(`  site transfers                : ${transfers.length}`);
L(`  vehicle-site-month bills      : ${billing.length}`);
L(`  months covered                : ${months[0]} .. ${months[months.length - 1]}`);
L(`\n  CROSS-CHECK — days billed never exceed the month: ${overruns.length === 0 ? "PASS" : "FAIL (" + overruns.length + ")"}`);
for (const [k, d] of overruns.slice(0, 5)) L(`     ${k} billed ${d} days`);
L(`\n  flagged for manual confirmation (fuel alternates between sites in a month): ${alternating.length}`);
L(`  vehicles with fuel but NO rate card (billed Rs 0): ${[...byVehicle.keys()].filter((v) => !rates.has(v)).length}`);
L(`\n  workbook: ${OUT}`);
db.close();
