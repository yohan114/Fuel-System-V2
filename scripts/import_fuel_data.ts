import { prisma } from "../src/lib/db";
import * as fs from "fs";

// Replay an exported fuel dataset into THIS database. Safe to run on a live server.
//
// Companion to export_fuel_data.ts. Carries issues, replenishment requests,
// meter readings and tank stock levels. deploy-to-vps.sh keeps the server's own
// database, so fuel imported on a workstation has to be carried across as data
// rather than as a file. This adds what is missing and nothing else:
//
//   * Never deletes or edits an existing fuel issue. Rows the operators entered
//     on the server, and rows not present in the export, are left untouched.
//   * Idempotent. Rows are reconciled by natural key (asset + timestamp +
//     litres + source + price) COUNT, not mere existence — 12 vehicles legitimately
//     refuelled twice on one day for the same litres, and those genuine repeats
//     must survive while a re-run still adds nothing.
//   * Foreign keys are re-resolved against this database's own ids: assets by
//     code then plate, tanks by project code, users by username.
//
// Tank stock is the one thing that cannot be merged: a balance is a single
// current number, not a history, so adopting the export's figure overwrites
// this instance's. That never happens automatically — differences are reported
// and only applied with --adopt-balances.
//
//   npx tsx scripts/import_fuel_data.ts               # dry run
//   npx tsx scripts/import_fuel_data.ts --apply
//   npx tsx scripts/import_fuel_data.ts --apply --create-missing-assets
//   npx tsx scripts/import_fuel_data.ts --apply --adopt-balances

const APPLY = process.argv.includes("--apply");
const CREATE_ASSETS = process.argv.includes("--create-missing-assets");
const ADOPT_BALANCES = process.argv.includes("--adopt-balances");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7)
  || "data/fuel-data-export.json";

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
// Price is part of the identity: a handful of rows share vehicle+day+litres+
// source but were priced differently, and without price in the key a restore
// could put back the right NUMBER of rows with the wrong rate on one of them.
const keyOf = (assetCode: string, iso: string, litres: number, source: string, price: number, cost: number) =>
  `${assetCode}|${iso}|${litres}|${source}|${price}|${cost}`;

async function main() {
  console.log(`\n=== Import fuel data (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  if (!fs.existsSync(FILE)) throw new Error(`export file not found: ${FILE}`);
  const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (payload.kind !== "fuel-data-export" && payload.kind !== "fuel-issues-export")
    throw new Error(`not a fuel export: ${FILE}`);
  console.log(`  file ${FILE} · exported ${payload.exportedAt} · ${payload.issues.length} issues\n`);

  // ---------------------------------------------------------------- referents
  const projByCode = new Map((await prisma.project.findMany()).map((p) => [p.code, p]));
  const tankByProj = new Map<string, { id: string }>();
  for (const t of payload.tanks || []) {
    if (!t.projectCode) continue;          // unattached tank: nothing to resolve against
    let proj = projByCode.get(t.projectCode);
    if (!proj) {
      console.log(`  project ${t.projectCode} (${t.projectName}) missing${APPLY ? " — creating" : " — would create"}`);
      if (APPLY) { proj = await prisma.project.create({ data: { code: t.projectCode, name: t.projectName } }); projByCode.set(proj.code, proj); }
    }
    if (!proj) continue;
    let tank = await prisma.bulkTank.findFirst({ where: { projectId: proj.id } });
    if (!tank) {
      console.log(`  tank for ${t.projectCode} missing${APPLY ? " — creating" : " — would create"}`);
      if (APPLY) tank = await prisma.bulkTank.create({ data: {
        name: t.tankName, fuelKind: t.fuelKind, capacity: t.capacity ?? 15000, balance: 0, projectId: proj.id } });
    }
    if (tank) tankByProj.set(t.projectCode, tank);
  }

  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true } });
  const byCode = new Map(assets.map((a) => [alnum(a.code), a]));
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [alnum(a.regNo!), a]));

  const users = new Map((await prisma.user.findMany({ select: { id: true, username: true, role: true } })).map((u) => [u.username, u]));
  const fallbackAdmin = [...users.values()].find((u) => u.role === "ADMIN");
  if (!fallbackAdmin) throw new Error("no ADMIN user in this database to attribute imported issues to");

  const priceRows = await prisma.fuelPrice.findMany({ select: { id: true, fuelKind: true, effectiveFrom: true } });
  const priceByKey = new Map(priceRows.map((p) => [`${p.fuelKind}|${p.effectiveFrom.toISOString()}`, p]));

  // ------------------------------------------------- what this database has
  const live = await prisma.fuelIssue.findMany({
    select: { litres: true, source: true, issueDate: true, pricePerLitre: true, totalCost: true,
              asset: { select: { code: true } } } });
  const liveCount = new Map<string, number>();
  for (const f of live) {
    const k = keyOf(f.asset.code, f.issueDate.toISOString(), f.litres, f.source, f.pricePerLitre, f.totalCost);
    liveCount.set(k, (liveCount.get(k) || 0) + 1);
  }
  console.log(`  this database already holds ${live.length} fuel issues\n`);

  // ------------------------------------------------------------- reconcile
  const emitted = new Map<string, number>();   // export rows of each key seen so far
  let created = 0, present = 0, missingAsset = 0, missingTank = 0, missingCategory = 0, litres = 0, cost = 0;
  const unmatched = new Map<string, number>();
  const createdAssets: string[] = [];
  const assetMeta = new Map<string, any>((payload.assets || []).map((a: any) => [a.code, a]));

  for (const i of payload.issues) {
    // For a key the export holds W times and this database holds L times, the
    // first L export rows are covered by what is already here and the rest are
    // new. Counting rather than testing existence is what preserves the genuine
    // twice-in-a-day refuels while keeping a re-run a no-op.
    const k = keyOf(i.asset, i.date, i.litres, i.source, i.pricePerLitre, i.totalCost);
    const already = liveCount.get(k) || 0;
    const done = emitted.get(k) || 0;
    emitted.set(k, done + 1);
    if (done < already) { present++; continue; }

    let asset = byCode.get(alnum(i.asset)) || (i.regNo ? byReg.get(alnum(i.regNo)) : undefined);
    if (!asset) {
      const meta = assetMeta.get(i.asset);
      if (CREATE_ASSETS && meta) {
        if (APPLY) {
          // Categories carry PM schedules and service intervals, so one is never
          // invented here — a fabricated category would hand the vehicle a wrong
          // maintenance plan. Match this database's own categories or give up.
          const cat = (meta.categoryCode ? await prisma.category.findUnique({ where: { code: meta.categoryCode } }) : null)
            || (meta.category ? await prisma.category.findFirst({ where: { name: meta.category } }) : null)
            || await prisma.category.findFirst({ where: { name: "Other Asset" } });
          if (!cat) {
            missingCategory++;
            unmatched.set(i.asset, (unmatched.get(i.asset) || 0) + 1);
            continue;
          }
          const proj = meta.project ? projByCode.get(meta.project) : null;
          const made = await prisma.asset.create({ data: {
            code: meta.code, regNo: meta.regNo, typeLabel: meta.typeLabel,
            status: meta.status || "ACTIVE", meterType: meta.meterType || "KM",
            ownership: meta.ownership || "OWNED", categoryId: cat.id, projectId: proj?.id ?? null } });
          asset = { id: made.id, code: made.code, regNo: made.regNo };
          byCode.set(alnum(made.code), asset);
          if (made.regNo) byReg.set(alnum(made.regNo), asset);
        } else {
          asset = { id: "(dry-run)", code: i.asset, regNo: i.regNo ?? null };
        }
        createdAssets.push(i.asset);
      } else {
        missingAsset++;
        unmatched.set(i.asset, (unmatched.get(i.asset) || 0) + 1);
        continue;
      }
    }

    const tank = i.tankProject ? tankByProj.get(i.tankProject) : undefined;
    if (i.tankProject && !tank && APPLY) { missingTank++; continue; }

    if (APPLY) {
      await prisma.fuelIssue.create({ data: {
        fuelKind: i.fuelKind,
        litres: i.litres,
        meterReading: i.meterReading ?? null,
        readingType: i.readingType ?? null,
        pricePerLitre: i.pricePerLitre,
        totalCost: i.totalCost,
        source: i.source,
        issueDate: new Date(i.date),
        issuePerson: i.issuePerson ?? null,
        voided: !!i.voided,
        voidedAt: i.voidedAt ? new Date(i.voidedAt) : null,
        assetId: asset.id,
        issuedById: (i.issuedBy && users.get(i.issuedBy)?.id) || fallbackAdmin.id,
        fuelPriceId: i.priceEffectiveFrom
          ? (priceByKey.get(`${i.fuelKind}|${i.priceEffectiveFrom}`)?.id ?? null) : null,
        bulkTankId: tank?.id ?? null,
      }});
    }
    emitted.set(k, done + 1);
    created++; litres += i.litres; cost += i.totalCost;
  }

  // ------------------------------------------------- replenishment requests
  // A pump's stock level is meaningless without the deliveries that filled it,
  // so these travel with the issues. Matched on tank + litres + submission
  // time, which is unique in practice for a delivery.
  let reqAdded = 0, reqPresent = 0, reqNoTank = 0;
  for (const b of payload.bulkRequests || []) {
    const tank = await prisma.bulkTank.findFirst({ where: { name: b.tank }, select: { id: true } });
    if (!tank) { reqNoTank++; continue; }
    const when = new Date(b.createdAt);
    const dup = await prisma.bulkRequest.findFirst({
      where: { bulkTankId: tank.id, requestedLitres: b.litres, createdAt: when }, select: { id: true } });
    if (dup) { reqPresent++; continue; }
    if (APPLY) {
      const src = b.sourceTank ? await prisma.bulkTank.findFirst({ where: { name: b.sourceTank }, select: { id: true } }) : null;
      await prisma.bulkRequest.create({ data: {
        fuelKind: b.fuelKind, requestedLitres: b.litres, status: b.status,
        createdAt: when, sourceType: b.sourceType || "OUTSIDE", sourceTankId: src?.id ?? null,
        bulkTankId: tank.id,
        requestedById: (b.requestedBy && users.get(b.requestedBy)?.id) || fallbackAdmin.id,
        reviewedById: (b.reviewedBy && users.get(b.reviewedBy)?.id) || null,
        reviewedAt: b.reviewedAt ? new Date(b.reviewedAt) : null,
        reviewNote: b.reviewNote ?? null,
      }});
    }
    reqAdded++;
  }

  // ------------------------------------------------------------ meter readings
  let mrAdded = 0, mrPresent = 0, mrNoAsset = 0;
  for (const m of payload.meterReadings || []) {
    const asset = byCode.get(alnum(m.asset));
    if (!asset) { mrNoAsset++; continue; }
    const when = new Date(m.readingDate);
    const dup = await prisma.meterReading.findFirst({
      where: { assetId: asset.id, readingDate: when, value: m.value }, select: { id: true } });
    if (dup) { mrPresent++; continue; }
    if (APPLY) await prisma.meterReading.create({ data: {
      value: m.value, readingType: m.readingType, readingDate: when, source: m.source || "MANUAL",
      assetId: asset.id,
      recordedById: (m.recordedBy && users.get(m.recordedBy)?.id) || fallbackAdmin.id,
    }});
    mrAdded++;
  }

  // -------------------------------------------------------------- tank stock
  // A balance is a single current number, not a history — merging two of them is
  // meaningless, so adopting the export's figure overwrites this instance's and
  // is never automatic. Only tanks whose balance actually differs are touched.
  const balanceChanges: string[] = [];
  for (const t of payload.tanks || []) {
    if (typeof t.balance !== "number") continue;
    const tank = await prisma.bulkTank.findFirst({ where: { name: t.tankName }, select: { id: true, balance: true } });
    if (!tank || tank.balance === t.balance) continue;
    balanceChanges.push(`${t.tankName}: ${tank.balance} L → ${t.balance} L`);
    if (APPLY && ADOPT_BALANCES) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: t.balance } });
  }

  // ------------------------------------------------------------------ report
  console.log(`=== RESULT ===`);
  console.log(`  ${APPLY ? "added" : "would add"}: ${created} issues · ${litres.toFixed(0)} L · ${rs(cost)}`);
  console.log(`  already present, left alone: ${present}`);
  if (createdAssets.length) console.log(`  assets ${APPLY ? "created" : "to create"}: ${createdAssets.length} (${[...new Set(createdAssets)].slice(0, 12).join(", ")}${createdAssets.length > 12 ? " …" : ""})`);
  if (missingAsset) {
    console.log(`\n  SKIPPED — ${missingAsset} issues for ${unmatched.size} vehicles not in this database:`);
    for (const [c, n] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`      ${c.padEnd(14)} ${n} issues`);
    console.log(`  Re-run with --create-missing-assets to add those vehicles and their fuel.`);
  }
  if (missingTank) console.log(`  SKIPPED — ${missingTank} issues whose tank could not be resolved`);
  if (missingCategory) console.log(`  SKIPPED — ${missingCategory} issues whose vehicle category does not exist here (import the fleet first)`);

  console.log(`\n  replenishments: ${APPLY ? "added" : "would add"} ${reqAdded}, already present ${reqPresent}` +
    (reqNoTank ? `, skipped ${reqNoTank} with no matching tank` : ""));
  console.log(`  meter readings: ${APPLY ? "added" : "would add"} ${mrAdded}, already present ${mrPresent}` +
    (mrNoAsset ? `, skipped ${mrNoAsset} with no matching vehicle` : ""));
  if (balanceChanges.length) {
    if (ADOPT_BALANCES) console.log(`\n  tank stock ${APPLY ? "set" : "would be set"} from the export (${balanceChanges.length} tanks):`);
    else console.log(`\n  tank stock DIFFERS on ${balanceChanges.length} tanks — not changed (pass --adopt-balances to take the export's figures):`);
    for (const c of balanceChanges.slice(0, 15)) console.log(`      ${c}`);
    if (balanceChanges.length > 15) console.log(`      … and ${balanceChanges.length - 15} more`);
  } else console.log(`\n  tank stock: identical on every tank`);

  const after = await prisma.fuelIssue.count();
  console.log(`\n  fuel issues in this database now: ${after}`);
  if (!APPLY) console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`);
  else console.log(`\nDone. No existing row was modified or deleted.` +
    (ADOPT_BALANCES ? ` Tank stock adopted from the export.\n` : ` Tank stock untouched.\n`));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
