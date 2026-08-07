import { prisma } from "../src/lib/db";
import * as fs from "fs";
import * as path from "path";

// Dump this database's fuel records to a portable file another instance can import.
//
// data/app.db cannot simply be shipped between instances: deploy-to-vps.sh
// restores the LIVE database over the repo's copy on purpose, so operators never
// lose what they typed. Fuel entered on one instance therefore never reaches the
// other. This writes a database-independent payload instead, which
// import_fuel_data.ts replays into whichever instance it is pointed at.
//
// Primary keys are UUIDs and do not survive across databases, so every row is
// exported by natural key and every foreign key by a human name — project code,
// username, price date — for the importer to re-resolve against local ids.
//
// Carries the whole fuel picture, not just issues: a pump's stock level is
// meaningless without the deliveries that filled it, so tank balances and
// replenishment requests travel too, along with meter readings.
//
//   npx tsx scripts/export_fuel_data.ts

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6)
  || "data/fuel-data-export.json";


// Print the database this run will actually touch. A server can have several
// SQLite files side by side — the repo's committed data/app.db, a dev.db, an
// env-configured live one — and silently reading or writing the wrong one looks
// exactly like success while the running app sees nothing change.
function announceDatabase(): string {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const file = url.replace(/^file:/, "");
  const abs = path.resolve(process.cwd(), file);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
  return abs;
}

async function main() {
  console.log(`\n=== Export fuel data ===`);
  announceDatabase();

  const issues = await prisma.fuelIssue.findMany({
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    select: {
      fuelKind: true, litres: true, meterReading: true, readingType: true,
      pricePerLitre: true, totalCost: true, source: true, issueDate: true,
      issuePerson: true, voided: true, voidedAt: true,
      asset: { select: { code: true, regNo: true } },
      issuedBy: { select: { username: true } },
      fuelPrice: { select: { effectiveFrom: true } },
      bulkTank: { select: { project: { select: { code: true } } } },
    },
  });

  // Every tank, not only those with issues — a pump sitting at 0 L is itself a
  // fact the other instance needs, and balances are what the screens show.
  const tanks = await prisma.bulkTank.findMany({
    select: {
      name: true, fuelKind: true, capacity: true, balance: true,
      project: { select: { code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const bulkRequests = await prisma.bulkRequest.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      fuelKind: true, requestedLitres: true, status: true, createdAt: true,
      reviewedAt: true, reviewNote: true, sourceType: true,
      bulkTank: { select: { name: true } },
      sourceTank: { select: { name: true } },
      requestedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } },
    },
  });

  // Site allocations decide which vehicle is billed to which site and from what
  // date, so they belong with the fuel rather than being left behind: without
  // them a vehicle's arrival date, and therefore where its cost lands, does not
  // survive the trip.
  const assignments = await prisma.assetAssignment.findMany({
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: {
      startDate: true, endDate: true, note: true, driverName: true, billingType: true,
      asset: { select: { code: true } },
      project: { select: { code: true } },
      createdBy: { select: { username: true } },
    },
  });

  const meterReadings = await prisma.meterReading.findMany({
    orderBy: { readingDate: "asc" },
    select: {
      value: true, readingType: true, readingDate: true, source: true,
      asset: { select: { code: true } },
      recordedBy: { select: { username: true } },
    },
  });

  // Every site, not just the ones owning a tank. A site can hold allocations
  // without a pump of its own — Badalgama has 34 — and carrying only tank-owning
  // sites left those allocations with nothing to resolve against on the far side.
  const projects = await prisma.project.findMany({
    select: { code: true, name: true }, orderBy: { code: "asc" } });

  const assetCodes = new Set([...issues.map((i) => i.asset.code), ...meterReadings.map((m) => m.asset.code),
    ...assignments.map((a) => a.asset.code)]);
  const assets = await prisma.asset.findMany({
    where: { code: { in: [...assetCodes] } },
    select: {
      code: true, regNo: true, typeLabel: true, meterType: true, status: true, ownership: true,
      category: { select: { code: true, name: true } }, project: { select: { code: true } },
    },
    orderBy: { code: "asc" },
  });

  const payload = {
    kind: "fuel-data-export",
    version: 2,
    exportedAt: new Date().toISOString(),
    counts: {
      issues: issues.length, tanks: tanks.length,
      bulkRequests: bulkRequests.length, meterReadings: meterReadings.length,
      assignments: assignments.length, assets: assets.length, projects: projects.length,
    },
    projects: projects.map((p) => ({ code: p.code, name: p.name })),
    tanks: tanks.map((t) => ({
      tankName: t.name, fuelKind: t.fuelKind, capacity: t.capacity, balance: t.balance,
      projectCode: t.project?.code || null, projectName: t.project?.name || null,
    })),
    assets: assets.map((a) => ({
      code: a.code, regNo: a.regNo || null, typeLabel: a.typeLabel || null,
      categoryCode: a.category?.code || null, category: a.category?.name || null,
      meterType: a.meterType, status: a.status, ownership: a.ownership,
      project: a.project?.code || null,
    })),
    bulkRequests: bulkRequests.map((b) => ({
      tank: b.bulkTank.name, fuelKind: b.fuelKind, litres: b.requestedLitres,
      status: b.status, createdAt: b.createdAt.toISOString(),
      sourceType: b.sourceType, sourceTank: b.sourceTank?.name || null,
      requestedBy: b.requestedBy?.username || null,
      reviewedBy: b.reviewedBy?.username || null,
      reviewedAt: b.reviewedAt?.toISOString() || null,
      reviewNote: b.reviewNote || null,
    })),
    assignments: assignments.map((a) => ({
      asset: a.asset.code, project: a.project.code,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate?.toISOString() || null,
      note: a.note || null, driverName: a.driverName || null,
      billingType: a.billingType || null,
      createdBy: a.createdBy?.username || null,
    })),
    meterReadings: meterReadings.map((m) => ({
      asset: m.asset.code, value: m.value, readingType: m.readingType,
      readingDate: m.readingDate.toISOString(), source: m.source,
      recordedBy: m.recordedBy?.username || null,
    })),
    // null/false fields are dropped to keep the payload readable and small
    issues: issues.map((i) => {
      const o: Record<string, unknown> = {
        asset: i.asset.code,
        date: i.issueDate.toISOString(),
        litres: i.litres,
        fuelKind: i.fuelKind,
        pricePerLitre: i.pricePerLitre,
        totalCost: i.totalCost,
        source: i.source,
      };
      if (i.asset.regNo) o.regNo = i.asset.regNo;
      if (i.bulkTank?.project) o.tankProject = i.bulkTank.project.code;
      if (i.issuedBy?.username) o.issuedBy = i.issuedBy.username;
      if (i.issuePerson) o.issuePerson = i.issuePerson;
      if (i.meterReading !== null) o.meterReading = i.meterReading;
      if (i.readingType) o.readingType = i.readingType;
      if (i.fuelPrice) o.priceEffectiveFrom = i.fuelPrice.effectiveFrom.toISOString();
      if (i.voided) { o.voided = true; if (i.voidedAt) o.voidedAt = i.voidedAt.toISOString(); }
      return o;
    }),
  };

  const dest = path.resolve(process.cwd(), OUT);   // resolve, not join: --out= may be absolute
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 0));

  const litres = issues.reduce((s, i) => s + i.litres, 0);
  const stocked = tanks.filter((t) => t.balance > 0);
  console.log(`  fuel issues      ${issues.length}  (${litres.toFixed(0)} L)`);
  console.log(`  tanks            ${tanks.length}  (${stocked.length} holding stock, ${stocked.reduce((s, t) => s + t.balance, 0).toFixed(1)} L total)`);
  console.log(`  replenishments   ${bulkRequests.length}`);
  console.log(`  meter readings   ${meterReadings.length}`);
  console.log(`  site allocations ${assignments.length}`);
  console.log(`  sites            ${projects.length}`);
  console.log(`  assets           ${assets.length}`);
  if (!bulkRequests.length) console.log(`  note: this database has no replenishment history to export`);
  console.log(`\n  wrote ${OUT} (${(fs.statSync(dest).size / 1e6).toFixed(2)} MB)\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
