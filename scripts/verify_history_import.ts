// Verifies the history importer against the real "Service record.xlsx":
// seeds a few assets whose E&C codes appear in the sheet, imports, asserts the
// records + children landed, checks idempotency, then cleans up.
// Run: DATABASE_URL="file:./data/app.db" SERVICE_RECORD_DIR=/home/user/service-record \
//      npx tsx scripts/verify_history_import.ts
import { prisma } from "../src/lib/db";
import { importServiceHistory } from "./import_service_history";

const DIR = process.env.SERVICE_RECORD_DIR || "/home/user/service-record";
let failures = 0;
const assert = (c: boolean, m: string) => (c ? console.log("  ✅", m) : (console.error("  ❌", m), failures++));

async function main() {
  const tag = "HIST" + Date.now().toString().slice(-6);
  const admin = await prisma.user.upsert({ where: { username: "admin" }, update: {}, create: { username: "admin", name: "Administrator", passwordHash: "x", role: "ADMIN" } });
  const catH = await prisma.category.create({ data: { code: "VH" + tag, name: "Verify Hours", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" } });
  const catK = await prisma.category.create({ data: { code: "VK" + tag, name: "Verify KM", defaultMeterType: "KM", fleetGroup: "ROAD_VEHICLE" } });
  const spec: [string, string, string][] = [["LB-08", "HOURS", catH.id], ["DT-47", "KM", catK.id], ["TM-03", "KM", catK.id]];
  const assets = [];
  for (const [code, mt, cid] of spec) assets.push(await prisma.asset.create({ data: { code, meterType: mt, categoryId: cid } }));

  try {
    const s1 = await importServiceHistory({ dir: DIR, dryRun: false });
    assert(s1.created > 0, `first import created ${s1.created} records (matched ${s1.matched})`);

    let totalForTestAssets = 0;
    for (const a of assets) {
      const recs = await prisma.serviceRecord.findMany({ where: { assetId: a.id }, include: { oils: true, filters: true } });
      totalForTestAssets += recs.length;
      const child = recs.find((r) => r.oils.length || r.filters.length);
      console.log(`     ${a.code}: ${recs.length} records (sample children → oils ${child?.oils.length ?? 0}, filters ${child?.filters.length ?? 0})`);
      assert(recs.length > 0, `${a.code} received history records`);
      assert(recs.every((r) => r.note === "Imported from Service record.xlsx" && r.meterType === a.meterType), `${a.code} records tagged + meterType set`);
    }
    const child = await prisma.serviceFilter.findFirst({ where: { serviceRecord: { assetId: { in: assets.map((a) => a.id) } } } });
    assert(!!child, "filter line children were created from the sheet columns");

    // Idempotency: a second import must not duplicate.
    const s2 = await importServiceHistory({ dir: DIR, dryRun: false });
    const after = await prisma.serviceRecord.count({ where: { assetId: { in: assets.map((a) => a.id) } } });
    assert(s2.created === 0 && after === totalForTestAssets, `re-import is idempotent (created ${s2.created}, total still ${after})`);
  } finally {
    for (const a of assets) {
      await prisma.serviceRecord.deleteMany({ where: { assetId: a.id } });
      await prisma.asset.delete({ where: { id: a.id } });
    }
    await prisma.category.delete({ where: { id: catH.id } });
    await prisma.category.delete({ where: { id: catK.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    console.log("  (cleaned up)");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
