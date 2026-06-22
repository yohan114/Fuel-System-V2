// Verifies service attachments: inline Bytes round-trip + cascade delete.
// Run: DATABASE_URL="file:./data/app.db" npx tsx scripts/verify_attachments.ts
import { prisma } from "../src/lib/db";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else { console.error("  ❌", msg); failures++; }
}

async function main() {
  const tag = "ATT" + Date.now().toString().slice(-7);
  const cat = await prisma.category.create({ data: { code: tag, name: "Att Cat", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" } });
  const user = await prisma.user.create({ data: { username: "att_" + tag, name: "Att User", passwordHash: "x", role: "ADMIN" } });
  const asset = await prisma.asset.create({ data: { code: "HEX-" + tag, meterType: "HOURS", categoryId: cat.id } });
  const rec = await prisma.serviceRecord.create({
    data: { assetId: asset.id, serviceDate: new Date("2026-06-15"), meterType: "HOURS", recordedById: user.id },
  });

  try {
    const payload = Buffer.from("PDF-CONTENT-😀-" + "x".repeat(5000), "utf8");
    const att = await prisma.serviceAttachment.create({
      data: { serviceRecordId: rec.id, data: payload, originalName: "report.pdf", mimeType: "application/pdf", fileSize: payload.length, caption: "site copy", uploadedById: user.id },
    });

    const withAtt = await prisma.serviceRecord.findUnique({ where: { id: rec.id }, include: { attachments: true } });
    assert(withAtt?.attachments.length === 1, "attachment linked to record");
    const back = Buffer.from(withAtt!.attachments[0].data);
    assert(back.length === payload.length && back.equals(payload), `bytes round-trip intact (${back.length} bytes)`);
    assert(withAtt!.attachments[0].mimeType === "application/pdf", "mime type stored");

    // Cascade: deleting the record removes its attachments.
    await prisma.serviceRecord.delete({ where: { id: rec.id } });
    const orphan = await prisma.serviceAttachment.findUnique({ where: { id: att.id } });
    assert(orphan === null, "attachment cascade-deleted with its record");
  } finally {
    await prisma.serviceAttachment.deleteMany({ where: { serviceRecordId: rec.id } });
    await prisma.serviceRecord.deleteMany({ where: { id: rec.id } });
    await prisma.asset.delete({ where: { id: asset.id } });
    await prisma.category.delete({ where: { id: cat.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("  (cleaned up)");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
