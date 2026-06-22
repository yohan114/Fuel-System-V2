"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

// Accept images, PDFs, Office docs and plain text/CSV (matches the Service
// Record system's attachment panel).
const ALLOWED_EXACT = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("image/")) return true;
  if (mime.startsWith("text/")) return true;
  return ALLOWED_EXACT.has(mime);
}

export async function uploadServiceAttachmentsAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to add attachments" };
  }

  const serviceRecordId = formData.get("serviceRecordId")?.toString();
  if (!serviceRecordId) return { error: "Missing service record" };
  const caption = (formData.get("caption")?.toString() || "").trim();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Choose at least one file to upload" };

  const record = await prisma.serviceRecord.findUnique({ where: { id: serviceRecordId }, select: { id: true, assetId: true } });
  if (!record) return { error: "Service record not found" };

  // Validate every file before writing any.
  for (const f of files) {
    if (f.size > MAX_BYTES) return { error: `"${f.name}" is too large (max 25 MB)` };
    if (!isAllowedMime(f.type)) return { error: `"${f.name}" is not an accepted file type` };
  }

  try {
    for (const f of files) {
      const data = Buffer.from(await f.arrayBuffer());
      await prisma.serviceAttachment.create({
        data: {
          serviceRecordId,
          data,
          originalName: f.name || "attachment",
          mimeType: f.type || "application/octet-stream",
          fileSize: f.size,
          caption,
          uploadedById: admin.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "ServiceAttachment",
        entityId: serviceRecordId,
        summary: `Attached ${files.length} file${files.length === 1 ? "" : "s"} to a service record`,
      },
    });

    revalidatePath(`/service/records/${serviceRecordId}`);
    return { success: true, count: files.length };
  } catch (err: any) {
    console.error("Upload attachment error:", err);
    return { error: err.message || "Failed to upload attachment" };
  }
}

export async function deleteServiceAttachmentAction(id: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to remove attachments" };
  }
  try {
    const att = await prisma.serviceAttachment.findUnique({ where: { id }, select: { serviceRecordId: true, originalName: true } });
    if (!att) return { error: "Attachment not found" };
    await prisma.serviceAttachment.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "DELETE", entity: "ServiceAttachment", entityId: id, summary: `Removed attachment ${att.originalName}` },
    });
    revalidatePath(`/service/records/${att.serviceRecordId}`);
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to remove attachment" };
  }
}
