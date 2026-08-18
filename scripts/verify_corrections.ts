import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { approveCorrectionAction } from "../src/app/actions/correction";
import { sumFuelForWindow } from "../src/lib/billing/usage";

// Verifies the correction flow end-to-end against the dev DB. Run with auth
// bypassed so the actions resolve the seeded admin:
//   TEST_ENV=true npx tsx scripts/verify_corrections.ts
//
// (approveCorrectionAction calls revalidatePath, which warns outside a request —
// harmless here; the DB transaction commits regardless, and we assert on the DB.)

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 9, 0, 0, 0);
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  cond ? pass++ : fail++;
}

async function main() {
  const admin = (await prisma.user.findFirst({ where: { username: "admin" } })) ??
    (await prisma.user.create({ data: { username: "admin", name: "Admin", passwordHash: "x", role: "ADMIN" } }));
  const cat = await prisma.category.create({ data: { code: "ZZC", name: "t", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" } });
  const proj = await prisma.project.create({ data: { name: "ZZ Corr Site", code: "ZZCOR" } });
  const asset = await prisma.asset.create({ data: { code: "ZZ-COR-1", categoryId: cat.id, meterType: "HOURS", status: "ACTIVE", projectId: proj.id } });

  // EDIT scenario: issue of 80L @ Rs300, linked meter reading 500h.
  const reading = await prisma.meterReading.create({ data: { assetId: asset.id, value: 500, readingType: "HOURS", readingDate: d(2026, 9, 5), source: "FUEL_ISSUE", recordedById: admin.id } });
  const issue = await prisma.fuelIssue.create({
    data: { assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: 80, meterReading: 500, readingType: "HOURS", pricePerLitre: 30_000, totalCost: 2_400_000, source: "BADALGAMA", issueDate: d(2026, 9, 5), issuedById: admin.id, meterReadingRecordId: reading.id },
  });
  await prisma.meterReading.update({ where: { id: reading.id }, data: { linkedIssueId: issue.id } });

  const editCorr = await prisma.fuelIssueCorrection.create({
    data: {
      fuelIssueId: issue.id, type: "EDIT", reason: "Typo: was 80, should be 60; meter 500→520",
      newLitres: 60, newMeterReading: 520, newReadingType: "HOURS",
      origLitres: 80, origMeterReading: 500, origFuelKind: "AUTO_DIESEL", origIssueDate: issue.issueDate, origSource: "BADALGAMA",
      assetId: asset.id, assetCode: asset.code, projectId: proj.id, projectName: proj.name, projectCode: proj.code,
      docData: Buffer.from("FAKE-RUNNING-CHART-IMAGE-BYTES"), docName: "chart.jpg", docMime: "image/jpeg",
      requestedById: admin.id,
    },
  });

  // Bytes round-trips intact?
  const docRead = await prisma.fuelIssueCorrection.findUnique({ where: { id: editCorr.id }, select: { docData: true, docMime: true } });
  check("document BLOB round-trips", Buffer.from(docRead!.docData).toString() === "FAKE-RUNNING-CHART-IMAGE-BYTES", `mime=${docRead!.docMime}`);

  try { await approveCorrectionAction(editCorr.id, "ok"); } catch { /* revalidate warning outside request */ }

  const afterEdit = await prisma.fuelIssue.findUnique({ where: { id: issue.id } });
  const afterReading = await prisma.meterReading.findUnique({ where: { id: reading.id } });
  const afterCorr = await prisma.fuelIssueCorrection.findUnique({ where: { id: editCorr.id } });
  check("EDIT applied: litres 80→60", afterEdit!.litres === 60);
  check("EDIT recomputed total 60×Rs300=Rs18,000", afterEdit!.totalCost === 1_800_000, `got Rs.${afterEdit!.totalCost / 100}`);
  check("EDIT synced linked meter 500→520", afterReading!.value === 520);
  check("EDIT correction marked APPROVED", afterCorr!.status === "APPROVED");

  // VOID scenario: a duplicate 40L issue.
  const dup = await prisma.fuelIssue.create({ data: { assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: 40, pricePerLitre: 30_000, totalCost: 1_200_000, source: "ZZCOR", issueDate: d(2026, 9, 6), issuedById: admin.id } });
  const voidCorr = await prisma.fuelIssueCorrection.create({
    data: {
      fuelIssueId: dup.id, type: "VOID", reason: "Duplicate entry",
      origLitres: 40, origFuelKind: "AUTO_DIESEL", origIssueDate: dup.issueDate, origSource: "ZZCOR",
      assetId: asset.id, assetCode: asset.code, projectId: proj.id, projectName: proj.name, projectCode: proj.code,
      docData: Buffer.from("DOC2"), docName: "d.pdf", docMime: "application/pdf", requestedById: admin.id,
    },
  });
  try { await approveCorrectionAction(voidCorr.id, "dup"); } catch {}
  const afterVoid = await prisma.fuelIssue.findUnique({ where: { id: dup.id } });
  check("VOID marked issue voided", afterVoid!.voided === true);

  // Billing must now ignore the voided issue: only the corrected 60L remains.
  const fuel = await sumFuelForWindow(asset.id, d(2026, 9, 1), new Date(2026, 8, 30, 23, 59, 59));
  check("billing excludes voided issue (60L only)", fuel.litres === 60, `litres=${fuel.litres} cost=Rs.${fuel.costCents / 100}`);

  // Cleanup
  await prisma.fuelIssueCorrection.deleteMany({ where: { assetId: asset.id } });
  await prisma.meterReading.deleteMany({ where: { assetId: asset.id } });
  await prisma.fuelIssue.deleteMany({ where: { assetId: asset.id } });
  await prisma.asset.delete({ where: { id: asset.id } });
  await prisma.project.delete({ where: { id: proj.id } });
  await prisma.category.delete({ where: { id: cat.id } });

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
