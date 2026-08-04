import { prisma } from "../src/lib/db";
import * as fs from "fs";
import * as path from "path";

// Dump every fuel issue to a portable file the VPS can import.
//
// data/app.db cannot simply be shipped to the server: deploy-to-vps.sh restores
// the LIVE database over the repo's copy on purpose, so operators never lose
// what they typed. That means fuel imported here never reaches production. This
// writes a database-independent payload instead, which import_fuel_issues.ts
// replays into the live database.
//
// Primary keys are UUIDs and do not survive across databases, so every row is
// exported by natural key (asset code + timestamp + litres + source) and every
// foreign key by a human name — project code, username, price date — for the
// importer to re-resolve against whatever ids the live server uses.
//
//   npx tsx scripts/export_fuel_issues.ts

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6)
  || "data/fuel-issues-export.json";

async function main() {
  console.log(`\n=== Export fuel issues ===`);

  const issues = await prisma.fuelIssue.findMany({
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    select: {
      fuelKind: true, litres: true, meterReading: true, readingType: true,
      pricePerLitre: true, totalCost: true, source: true, issueDate: true,
      issuePerson: true, voided: true, voidedAt: true,
      asset: { select: { code: true, regNo: true } },
      issuedBy: { select: { username: true } },
      fuelPrice: { select: { effectiveFrom: true, fuelKind: true } },
      bulkTank: { select: { name: true, fuelKind: true, capacity: true, project: { select: { code: true, name: true } } } },
    },
  });

  // Only the assets/tanks actually referenced, so the importer can rebuild a
  // missing referent instead of dropping the fuel that points at it.
  const assetCodes = new Set(issues.map((i) => i.asset.code));
  const assets = await prisma.asset.findMany({
    where: { code: { in: [...assetCodes] } },
    select: {
      code: true, regNo: true, typeLabel: true, meterType: true, status: true, ownership: true,
      category: { select: { code: true, name: true } }, project: { select: { code: true } },
    },
    orderBy: { code: "asc" },
  });

  const tankKeys = new Map<string, any>();
  for (const i of issues) {
    const t = i.bulkTank;
    if (!t?.project) continue;
    if (!tankKeys.has(t.project.code)) tankKeys.set(t.project.code, {
      projectCode: t.project.code, projectName: t.project.name,
      tankName: t.name, fuelKind: t.fuelKind, capacity: t.capacity,
    });
  }

  const payload = {
    kind: "fuel-issues-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { issues: issues.length, assets: assets.length, tanks: tankKeys.size },
    tanks: [...tankKeys.values()],
    assets: assets.map((a) => ({
      code: a.code, regNo: a.regNo || null, typeLabel: a.typeLabel || null,
      categoryCode: a.category?.code || null, category: a.category?.name || null, meterType: a.meterType,
      status: a.status, ownership: a.ownership, project: a.project?.code || null,
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

  const dest = path.join(process.cwd(), OUT);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 0));

  const litres = issues.reduce((s, i) => s + i.litres, 0);
  const cost = issues.reduce((s, i) => s + i.totalCost, 0);
  const bySource = new Map<string, number>();
  for (const i of issues) bySource.set(i.source, (bySource.get(i.source) || 0) + 1);

  console.log(`  issues  ${issues.length}`);
  console.log(`  litres  ${litres.toFixed(0)}`);
  console.log(`  value   Rs ${(cost / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`  assets  ${assets.length} · tanks ${tankKeys.size}`);
  console.log(`\n  top sources:`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 8))
    console.log(`    ${String(n).padStart(5)}  ${s}`);
  console.log(`\n  wrote ${OUT} (${(fs.statSync(dest).size / 1e6).toFixed(2)} MB)\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
