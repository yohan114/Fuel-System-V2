import { prisma } from "../src/lib/db";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { readLong, type Fill } from "./fuel-import/readers/long";
import { SITES, type SiteProfile } from "./fuel-import/sites";

// One importer for every site fuel workbook.
//
//   npx tsx scripts/import_site_fuel.ts MANN                    # dry run
//   npx tsx scripts/import_site_fuel.ts MANN --apply
//   npx tsx scripts/import_site_fuel.ts MANN MUTUR ING          # several
//   npx tsx scripts/import_site_fuel.ts --all
//
// Dry run is the default and prints exactly what --apply would write.
//
// FOUR RULES THIS WILL NOT BREAK, each of them a defect that has already been
// paid for once:
//
//   1. It reads exactly the ONE view the profile names. Every workbook here
//      duplicates its data across per-day tabs, and a reader that walks
//      SheetNames counts everything twice.
//   2. It only ever appends. Two of the older importers delete the workbook's
//      date window before inserting, which would take out the rows that came
//      from a different document — 2 at Karaitivu, 14 at Avissawella.
//   3. It never registers an asset. An unmatched code stops the run and is
//      printed. Karaitivu's fleet still contains an ACTIVE, OWNED machine called
//      "LH Piyasena Piling" — a subcontractor's name that an importer invented.
//   4. It never moves stock. Pass --decrement-stock deliberately, and only once
//      the receipts side has been loaded; on this batch every site's deliveries
//      are still missing and three tanks would go straight to negative.

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const DECREMENT = ARGS.includes("--decrement-stock");
const ASSIGN = ARGS.includes("--assign");
const VERBOSE = ARGS.includes("--verbose");
const KEYS = ARGS.includes("--all")
  ? Object.keys(SITES)
  : ARGS.filter((a) => !a.startsWith("--"));

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const L = (n: number) => (Math.round(n * 100) / 100).toLocaleString();

/** Identity of the SHEET ROW this issue came from — not of its values.
 *  The basename rather than the full path, so moving the folder does not
 *  reissue every key; the project code because two sites can ship a workbook
 *  under the same filename. */
const importKeyOf = (p: SiteProfile, f: Fill) =>
  createHash("sha1")
    .update(`${path.basename(p.file)}|${f.sheet}|${f.excelRow}|${f.nth}|${p.project}`)
    .digest("hex");

type Row = Fill & { asset: Asset; how: string; key: string };
type Asset = { id: string; code: string; regNo: string | null; meterType: string; projectId: string | null };

async function importSite(key: string) {
  const p = SITES[key];
  if (!p) throw new Error(`no profile "${key}" — have: ${Object.keys(SITES).join(", ")}`);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`=== ${key} -> ${p.project}   (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`    ${path.basename(p.file)} · sheet ${p.spec.sheet ?? String(p.spec.sheets!.match)}`);
  console.log(`${"=".repeat(78)}`);

  const fills = readLong(p.file, p.spec).filter((f) => !p.dateCeiling || f.day <= p.dateCeiling);
  if (!fills.length) { console.log("  the sheet yielded no rows — check the profile"); return null; }

  const days = fills.map((f) => f.day).sort();
  const bookLitres = fills.reduce((s, f) => s + f.litres, 0);
  console.log(`\n  sheet: ${fills.length} fills · ${L(bookLitres)} L · ${days[0]} .. ${days[days.length - 1]}`);

  const project = await prisma.project.findUnique({ where: { code: p.project }, select: { id: true, name: true } });
  if (!project) throw new Error(`project ${p.project} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id }, select: { id: true, name: true, balance: true } });
  if (!tank) throw new Error(`no bulk tank for ${p.project}`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  // ─────────────────────────────────────────────────────────── resolve the fleet
  const assets: Asset[] = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true, projectId: true },
  });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));
  const look = (v: string) => byCode.get(alnum(v)) ?? byReg.get(alnum(v));

  // A handwritten plate loses one digit at a time — 6 read as 8, 1 as 7. Try the
  // string as written first, then single-digit substitutions, and accept the
  // result only when exactly ONE machine is a candidate. Two candidates is a
  // coin toss, and a coin toss puts one machine's fuel on another's permanent
  // record where nothing downstream will ever reveal it.
  const unresolved = new Map<string, { rows: number; litres: number; why: string }>();
  function resolve(label: string): { asset: Asset; how: string } | null {
    const aliased = p.aliases?.[label] ?? p.aliases?.[label.toUpperCase()];
    if (aliased) {
      const hit = look(aliased);
      if (hit) return { asset: hit, how: `alias -> ${aliased}` };
      note(label, `alias "${aliased}" is itself not in the fleet`);
      return null;
    }
    const direct = look(label);
    if (direct) return { asset: direct, how: "exact" };

    const cands = new Map<string, Asset>();
    for (let i = 0; i < label.length; i++) {
      if (!/\d/.test(label[i])) continue;
      for (const d of "0123456789") {
        if (d === label[i]) continue;
        const hit = look(label.slice(0, i) + d + label.slice(i + 1));
        if (hit) cands.set(hit.id, hit);
      }
    }
    if (cands.size === 1) return { asset: [...cands.values()][0], how: "one digit out" };
    if (cands.size > 1) {
      note(label, `could be any of ${[...cands.values()].map((a) => a.code).join(", ")}`);
      return null;
    }
    note(label, "matches nothing in the fleet");
    return null;
  }
  function note(label: string, why: string) {
    const e = unresolved.get(label) ?? { rows: 0, litres: 0, why };
    unresolved.set(label, e);
  }

  const parsed: Row[] = [];
  const held = new Map<string, { rows: number; litres: number; why: string }>();
  for (const f of fills) {
    const reason = p.holdBack?.[f.label];
    if (reason) {
      const e = held.get(f.label) ?? { rows: 0, litres: 0, why: reason };
      e.rows++; e.litres += f.litres;
      held.set(f.label, e);
      continue;
    }
    const r = resolve(f.label);
    if (!r) {
      const e = unresolved.get(f.label)!;
      e.rows++; e.litres += f.litres;
      continue;
    }
    parsed.push({ ...f, asset: r.asset, how: r.how, key: importKeyOf(p, f) });
  }

  if (held.size) {
    const total = [...held.values()].reduce((s, e) => s + e.litres, 0);
    console.log(`\n  HELD BACK — ${held.size} label(s), ${[...held.values()].reduce((s, e) => s + e.rows, 0)} rows, ${L(total)} L NOT imported:`);
    for (const [label, e] of held) {
      console.log(`      ${label.padEnd(22)} ${String(e.rows).padStart(3)} rows ${String(L(e.litres)).padStart(7)} L`);
      console.log(`        ${e.why}`);
    }
  }

  if (unresolved.size) {
    console.log(`\n  ${unresolved.size} LABEL(S) DO NOT RESOLVE — nothing will be written:`);
    for (const [label, e] of [...unresolved].sort((a, b) => b[1].litres - a[1].litres)) {
      console.log(`      ${label.padEnd(22)} ${String(e.rows).padStart(3)} rows ${String(L(e.litres)).padStart(7)} L   ${e.why}`);
    }
    console.log(`\n  Add each to the site's alias table in scripts/fuel-import/sites.ts with the`);
    console.log(`  evidence for it, or have the site correct the sheet. Nothing is auto-created:`);
    console.log(`  an invented machine is invisible afterwards and bills real money.`);
    throw new Error(`${key}: ${unresolved.size} unresolved label(s)`);
  }

  // ──────────────────────────────────────────────── what the pump already holds
  const lo = colombo(days[0]);
  const hi = new Date(colombo(days[days.length - 1]).getTime() + 86_400_000);
  const live = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false, issueDate: { gte: lo, lt: hi } },
    select: { id: true, assetId: true, issueDate: true, litres: true, meterReading: true, importKey: true },
  });
  const byKey = new Map(live.filter((l) => l.importKey).map((l) => [l.importKey!, l]));
  const liveCount = new Map<string, number>();
  for (const l of live) {
    const k = `${dayOf(l.issueDate)}|${l.assetId}`;
    liveCount.set(k, (liveCount.get(k) ?? 0) + 1);
  }
  console.log(`  pump: ${live.length} row(s) already in that window (${byKey.size} carry an import key)`);

  // Two guards, in this order.
  //
  //   1. importKey — exact row identity. A re-run of the same workbook is a
  //      no-op no matter what was edited in it, and an edited value shows up as
  //      an update candidate instead of a second charge.
  //   2. (day, asset) count — for the six historical loads whose scripts were
  //      never checked in and which therefore carry no key. Counting rather than
  //      matching on litres is deliberate: it keeps the same-day repeat fills,
  //      which are real and common, and it settles a half-imported day exactly
  //      (LOT-04's 13 Aug holds 6 of 19 rows; a date filter either loses 380 L
  //      or doubles 110 L, and this loses neither).
  const emitted = new Map<string, number>();
  const fresh: Row[] = [];
  const drifted: { row: Row; was: { litres: number; meter: number | null } }[] = [];
  let seenByKey = 0, seenByCount = 0;

  for (const row of parsed) {
    const hit = byKey.get(row.key);
    if (hit) {
      seenByKey++;
      // Compare against what this importer WOULD store, not against the raw
      // cell. A reading listed in untrustedMeters is deliberately written as
      // null, so comparing the sheet value would report every one of them as
      // changed on every re-run and bury a genuine edit in the noise.
      const wouldStore = p.untrustedMeters?.has(`${row.day}|${row.label}`) ? null : row.meter;
      if (hit.litres !== row.litres || (hit.meterReading ?? null) !== wouldStore) {
        drifted.push({ row, was: { litres: hit.litres, meter: hit.meterReading ?? null } });
      }
      continue;
    }
    const k = `${row.day}|${row.asset.id}`;
    const already = liveCount.get(k) ?? 0;
    const done = emitted.get(k) ?? 0;
    emitted.set(k, done + 1);
    if (done < already) { seenByCount++; continue; }
    fresh.push(row);
  }

  if (drifted.length) {
    console.log(`\n  ${drifted.length} ROW(S) CHANGED IN THE SHEET SINCE THEY WERE IMPORTED — not applied:`);
    for (const d of drifted) {
      console.log(`      ${d.row.sheet}!${d.row.excelRow} ${d.row.day} ${d.row.asset.code.padEnd(10)} ` +
        `litres ${d.was.litres} -> ${d.row.litres}   meter ${d.was.meter ?? "-"} -> ${d.row.meter ?? "-"}`);
    }
    console.log(`      A corrected figure is an edit to a charge already raised, so it goes`);
    console.log(`      through a FuelIssueCorrection with evidence, not through a re-import.`);
  }

  // ─────────────────────────────────────────── meter sanity, before any writing
  // A cumulative meter cannot go backwards. The console refuses such an entry
  // one row at a time; an importer without this check writes in bulk what the UI
  // blocks. Run AFTER dedupe, so a row already imported is never checked against
  // its own reading and reported as a regression on every re-run.
  // The datum is the LAST reading by date, not the highest ever seen. Those are
  // the same thing on a healthy meter and very different on a real one: LD-07's
  // history holds a single 10979.02 among readings running 10218 -> 10299, a
  // 9-for-2 slip in the hundreds digit that was imported months ago. Comparing
  // against MAX would let that one bad digit block every future import for that
  // machine forever, which is the opposite of a safety check. A reading below
  // the historical high but above the last one is reported and let through.
  const untrusted = p.untrustedMeters ?? new Set<string>();
  const withMeter = fresh.filter((r) => r.meter !== null && !untrusted.has(`${r.day}|${r.label}`));
  const problems: string[] = [];
  const outliers: string[] = [];
  for (const [assetId, rows] of groupBy(withMeter, (r) => r.asset.id)) {
    const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.nth - b.nth);
    const open = sorted[0];
    const [last, peak] = await Promise.all([
      prisma.meterReading.findFirst({
        where: { assetId, readingDate: { lt: colombo(open.day) } },
        orderBy: [{ readingDate: "desc" }], select: { value: true, readingDate: true },
      }),
      prisma.meterReading.findFirst({
        where: { assetId, readingDate: { lt: colombo(open.day) } },
        orderBy: [{ value: "desc" }], select: { value: true, readingDate: true },
      }),
    ]);
    const trusted = p.trustSheetMeter?.[open.label];
    if (trusted) {
      outliers.push(`${open.asset.code}: opening check lifted — ${trusted}`);
    } else if (last && open.meter! < last.value) {
      problems.push(`${open.asset.code}: sheet opens at ${open.meter} (${open.day}) but the machine was last read at ${last.value} on ${dayOf(last.readingDate)}`);
    } else if (peak && open.meter! < peak.value) {
      outliers.push(`${open.asset.code}: sheet opens at ${open.meter}, under the ${peak.value} recorded on ${dayOf(peak.readingDate)} — that earlier reading looks like the wrong one`);
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].meter! < sorted[i - 1].meter!) {
        problems.push(`${sorted[i].asset.code}: ${sorted[i].day} reads ${sorted[i].meter} after ${sorted[i - 1].meter} on ${sorted[i - 1].day}  [${sorted[i].sheet}!${sorted[i].excelRow}]`);
      }
    }
  }
  if (outliers.length) {
    console.log(`\n  ${outliers.length} machine(s) already hold a reading above where the sheet resumes:`);
    for (const m of outliers) console.log(`      ${m}`);
    console.log(`      Import proceeds — the new readings are consistent with each other and`);
    console.log(`      with the reading before them. The old one wants correcting separately.`);
  }
  if (problems.length) {
    console.log(`\n  METER READINGS GO BACKWARDS — nothing will be written:`);
    for (const m of problems) console.log(`      ${m}`);
    console.log(`\n  Either the sheet has a transcription error, or the reading is genuinely`);
    console.log(`  untrusted — in which case add "yyyy-mm-dd|LABEL" to the site's`);
    console.log(`  untrustedMeters set, which drops the reading and keeps the fuel.`);
    throw new Error(`${key}: ${problems.length} meter regression(s)`);
  }

  // ───────────────────────────────────────────────────────────── price + write
  const prices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "asc" },
    select: { id: true, pricePerLitre: true, effectiveFrom: true },
  });
  // A price effective "from 1 July" covers the whole of 1 July in Colombo; the
  // raw instants would put a row stored at Colombo midnight 5½ hours before it.
  const priceOn = (day: string) => {
    let x = prices[0];
    for (const q of prices) { if (dayOf(q.effectiveFrom) <= day) x = q; else break; }
    return x;
  };

  let added = 0, litres = 0, cost = 0, meters = 0;
  for (const row of fresh) {
    const when = colombo(row.day);
    const price = priceOn(row.day);
    const c = Math.round(row.litres * price.pricePerLitre);
    const keepMeter = row.meter !== null && !untrusted.has(`${row.day}|${row.label}`);
    added++; litres += row.litres; cost += c;
    if (keepMeter) meters++;

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      const issue = await tx.fuelIssue.create({
        data: {
          fuelKind: "AUTO_DIESEL", litres: row.litres,
          meterReading: keepMeter ? row.meter : null,
          readingType: keepMeter ? row.asset.meterType : null,
          pricePerLitre: price.pricePerLitre, totalCost: c,
          source: p.source, issueDate: when, issuePerson: project.name,
          assetId: row.asset.id, issuedById: admin.id, fuelPriceId: price.id,
          bulkTankId: tank.id, importKey: row.key,
        },
      });
      if (keepMeter) {
        const reading = await tx.meterReading.create({
          data: {
            assetId: row.asset.id, value: row.meter!, readingType: row.asset.meterType,
            readingDate: when, source: "FUEL_ISSUE", recordedById: admin.id, linkedIssueId: issue.id,
          },
        });
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { meterReadingRecordId: reading.id } });
      }
    });
  }

  // ───────────────────────────────────────────────────────── site arrival dates
  // Only for machines this site can claim: already posted here, or posted
  // nowhere at all. A machine that belongs elsewhere was a visitor at this pump
  // — a workshop pump fuels whatever drives up to it — and giving it an
  // open-ended posting here would quietly re-site it. Fuel is attributed by the
  // pump either way, so the charge lands correctly without touching the posting.
  //
  // BEHIND --assign, and off by default. Fuel and posting are different facts.
  // An AssetAssignment is what site rental is billed from, so writing 29 of them
  // as a side effect of loading a fuel sheet starts charging 29 machines' hire
  // to a site on the strength of one refuel. The run reports what it would
  // create; turning it on is a separate decision.
  let arrivals = 0;
  const visitors: string[] = [];
  const firstFill = new Map<string, string>();
  for (const r of parsed) {
    const cur = firstFill.get(r.asset.id);
    if (!cur || r.day < cur) firstFill.set(r.asset.id, r.day);
  }
  for (const [assetId, day] of firstFill) {
    const asset = assets.find((a) => a.id === assetId)!;
    if (asset.projectId && asset.projectId !== project.id) {
      const home = await prisma.project.findUnique({ where: { id: asset.projectId }, select: { code: true } });
      visitors.push(`${asset.code.padEnd(10)} posted to ${home?.code ?? "?"} — fuel recorded here, posting untouched`);
      continue;
    }
    if (await prisma.assetAssignment.findFirst({ where: { assetId, projectId: project.id }, select: { id: true } })) continue;
    arrivals++;
    if (APPLY && ASSIGN) {
      await prisma.assetAssignment.create({
        data: {
          assetId, projectId: project.id, startDate: colombo(day), endDate: null,
          note: `Allocated to site — first fuel ${day} (${p.source})`, createdById: admin.id,
        },
      });
    }
  }

  // ────────────────────────────────────────────────────────────────── report
  if (VERBOSE) {
    console.log(`\n  sheet label -> fleet machine`);
    for (const [label, rows] of [...groupBy(parsed, (r) => r.label)].sort((a, b) => a[0].localeCompare(b[0]))) {
      const a = rows[0].asset;
      const m = rows.filter((r) => r.meter !== null);
      console.log(`      ${label.padEnd(22)} -> ${a.code.padEnd(10)} ${String(rows.length).padStart(3)} fills ${String(L(rows.reduce((s, r) => s + r.litres, 0))).padStart(7)} L · ` +
        (m.length ? `${m.length} meter${m.length > 1 ? "s" : ""} ${Math.min(...m.map((r) => r.meter!))}–${Math.max(...m.map((r) => r.meter!))} ${a.meterType}` : "no meter") +
        (rows[0].how === "exact" ? "" : `   [${rows[0].how}]`));
    }
  }

  const byDay = [...groupBy(fresh, (r) => r.day)].sort((a, b) => a[0].localeCompare(b[0]));
  if (byDay.length) {
    console.log(`\n  new fuel by day`);
    for (const [day, rows] of byDay) {
      console.log(`      ${day}  ${String(rows.length).padStart(3)} fills  ${String(L(rows.reduce((s, r) => s + r.litres, 0))).padStart(8)} L`);
    }
  }

  console.log(`\n  fuel issues ${APPLY ? "added" : "to add"}: ${added} · ${L(litres)} L · ${rs(cost)}`);
  console.log(`  already present, left alone: ${seenByKey + seenByCount}  (${seenByKey} by import key, ${seenByCount} by day+machine count)`);
  console.log(`  meter readings ${APPLY ? "recorded" : "to record"}: ${meters} of ${added}`);
  console.log(`  site postings ${ASSIGN ? (APPLY ? "recorded" : "to record") : "NOT touched"}: ${arrivals} machine(s) fuelled here have no posting to this site` +
    (arrivals && !ASSIGN ? `  (--assign would create them)` : ""));
  for (const v of visitors) console.log(`      visitor: ${v}`);

  const after = Math.round((tank.balance - litres) * 100) / 100;
  console.log(`\n  ${tank.name}: ${L(tank.balance)} L` +
    (DECREMENT ? ` -> ${L(after)} L` : `  (unchanged — --decrement-stock would take ${L(litres)} L off, leaving ${L(after)} L)`));
  if (after < 0 && !DECREMENT) {
    console.log(`      that would be NEGATIVE. The deliveries into this tank are not loaded,`);
    console.log(`      so the issue side alone cannot balance. Leave stock alone until they are.`);
  }
  if (DECREMENT && APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: after } });

  return { key, added, litres, cost, skipped: seenByKey + seenByCount, drifted: drifted.length, meters, arrivals };
}

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return m;
}

async function main() {
  if (!KEYS.length) {
    console.log(`\nusage: npx tsx scripts/import_site_fuel.ts <SITE...> [--apply] [--verbose] [--decrement-stock]`);
    console.log(`       npx tsx scripts/import_site_fuel.ts --all\n`);
    console.log(`sites: ${Object.keys(SITES).join(", ")}\n`);
    return;
  }

  const done: NonNullable<Awaited<ReturnType<typeof importSite>>>[] = [];
  const failed: string[] = [];
  for (const k of KEYS) {
    try {
      const r = await importSite(k);
      if (r) done.push(r);
    } catch (e) {
      failed.push(`${k}: ${(e as Error).message}`);
      console.log(`\n  >>> ${k} STOPPED: ${(e as Error).message}`);
    }
  }

  if (KEYS.length > 1) {
    console.log(`\n${"=".repeat(78)}\n=== TOTAL (${APPLY ? "applied" : "dry run"})\n${"=".repeat(78)}`);
    for (const d of done) {
      console.log(`  ${d.key.padEnd(10)} ${String(d.added).padStart(4)} issues  ${String(L(d.litres)).padStart(9)} L  ${rs(d.cost).padStart(16)}` +
        (d.drifted ? `   ${d.drifted} changed row(s) not applied` : ""));
    }
    const t = done.reduce((a, d) => ({ n: a.n + d.added, l: a.l + d.litres, c: a.c + d.cost }), { n: 0, l: 0, c: 0 });
    console.log(`  ${"".padEnd(10)} ${String(t.n).padStart(4)} issues  ${String(L(t.l)).padStart(9)} L  ${rs(t.c).padStart(16)}`);
    for (const f of failed) console.log(`  STOPPED  ${f}`);
  }

  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
