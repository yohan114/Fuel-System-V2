"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { canUserAccessAsset, getActiveAssignment } from "@/lib/assignments";
import { getPriceForDate } from "@/lib/pricing";
import { revalidatePath } from "next/cache";

const ALLOWED_MIME = (m: string) => m.startsWith("image/") || m === "application/pdf";
const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB

function parseNum(v: FormDataEntryValue | null): number | null {
  const s = v?.toString().trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: FormDataEntryValue | null): Date | null {
  const s = v?.toString().trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// A site user (or admin) requests a correction to a fuel issue, attaching the
// signed running-chart document as evidence. The request is PENDING until an
// admin approves it.
export async function submitCorrectionAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch {
    return { error: "You are not authorized to request corrections" };
  }

  const fuelIssueId = formData.get("fuelIssueId")?.toString();
  const type = formData.get("type")?.toString();
  const reason = formData.get("reason")?.toString().trim();

  if (!fuelIssueId || (type !== "EDIT" && type !== "VOID")) {
    return { error: "Pick a valid correction type" };
  }
  if (!reason) {
    return { error: "Please describe what is wrong and the correct value" };
  }

  // Mandatory evidence document.
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the signed running-chart document (photo or PDF)" };
  }
  if (file.size > MAX_DOC_BYTES) {
    return { error: "Document is too large (max 10 MB)" };
  }
  if (!ALLOWED_MIME(file.type)) {
    return { error: "Document must be an image or a PDF" };
  }

  try {
    const issue = await prisma.fuelIssue.findUnique({
      where: { id: fuelIssueId },
      include: { asset: { include: { project: true } } },
    });
    if (!issue) return { error: "Fuel issue not found" };
    if (issue.voided) return { error: "This issue is already voided" };

    // Site users may only correct issues for vehicles assigned to their site
    // (checked on the issue date).
    if (user.role === "USER" && user.projectId) {
      const ok = await canUserAccessAsset(user, issue.assetId, issue.issueDate);
      if (!ok) return { error: "This issue belongs to a vehicle outside your site" };
    }

    // Block stacking multiple pending requests on the same issue.
    const pending = await prisma.fuelIssueCorrection.findFirst({
      where: { fuelIssueId, status: "PENDING" },
    });
    if (pending) return { error: "There is already a pending correction for this issue" };

    // Proposed edits (EDIT only).
    let newLitres: number | null = null;
    let newMeterReading: number | null = null;
    let newFuelKind: string | null = null;
    let newIssueDate: Date | null = null;
    if (type === "EDIT") {
      newLitres = parseNum(formData.get("newLitres"));
      newMeterReading = parseNum(formData.get("newMeterReading"));
      const fk = formData.get("newFuelKind")?.toString().trim();
      newFuelKind = fk && fk !== issue.fuelKind ? fk : null;
      const nd = parseDate(formData.get("newIssueDate"));
      newIssueDate = nd && nd.getTime() !== issue.issueDate.getTime() ? nd : null;

      // Discard "changes" that match the current value.
      if (newLitres !== null && newLitres === issue.litres) newLitres = null;
      if (newMeterReading !== null && newMeterReading === issue.meterReading) newMeterReading = null;

      if (newLitres !== null && (isNaN(newLitres) || newLitres <= 0)) {
        return { error: "Corrected litres must be greater than zero" };
      }
      if (newMeterReading !== null && newMeterReading < 0) {
        return { error: "Corrected meter reading must be zero or greater" };
      }
      if (newFuelKind && newFuelKind !== "AUTO_DIESEL" && newFuelKind !== "SUPER_DIESEL") {
        return { error: "Invalid fuel type" };
      }
      if (newLitres === null && newMeterReading === null && !newFuelKind && !newIssueDate) {
        return { error: "Change at least one value, or choose Void instead" };
      }
    }

    // Site snapshot from the active assignment on the issue date (fallback: pin).
    const active = await getActiveAssignment(issue.assetId, issue.issueDate);
    const proj = active?.project ?? issue.asset.project ?? null;

    const buf = Buffer.from(await file.arrayBuffer());

    await prisma.fuelIssueCorrection.create({
      data: {
        fuelIssueId,
        type,
        reason,
        newLitres,
        newMeterReading,
        newReadingType: newMeterReading !== null ? issue.readingType : null,
        newFuelKind,
        newIssueDate,
        origLitres: issue.litres,
        origMeterReading: issue.meterReading,
        origFuelKind: issue.fuelKind,
        origIssueDate: issue.issueDate,
        origSource: issue.source,
        assetId: issue.assetId,
        assetCode: issue.asset.code,
        projectId: proj?.id ?? null,
        projectName: proj?.name ?? null,
        projectCode: proj?.code ?? null,
        docData: buf,
        docName: file.name || "document",
        docMime: file.type,
        requestedById: user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entity: "FuelIssueCorrection",
        entityId: fuelIssueId,
        summary: `Requested ${type} correction for ${issue.asset.code} fuel issue (${proj?.code ?? "—"})`,
      },
    });

    revalidatePath("/fuel/corrections");
    revalidatePath("/fuel/issues");
    return { success: true };
  } catch (err: any) {
    console.error("Submit correction error:", err);
    return { error: err.message || "Failed to submit correction" };
  }
}

// Admin approves a correction: applies the edit (or voids the issue) and stamps
// the request APPROVED. All money is recomputed from the corrected values.
export async function approveCorrectionAction(correctionId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch {
    return { error: "You are not authorized to approve corrections" };
  }

  try {
    const corr = await prisma.fuelIssueCorrection.findUnique({
      where: { id: correctionId },
      include: { fuelIssue: true },
    });
    if (!corr) return { error: "Correction not found" };
    if (corr.status !== "PENDING") return { error: "This correction has already been reviewed" };

    const issue = corr.fuelIssue;

    await prisma.$transaction(async (tx) => {
      let summary: string;

      if (corr.type === "VOID") {
        await tx.fuelIssue.update({ where: { id: issue.id }, data: { voided: true, voidedAt: new Date() } });
        summary = `Voided ${corr.assetCode} fuel issue of ${issue.litres}L (${corr.projectCode ?? "—"})`;
      } else {
        const finalFuelKind = corr.newFuelKind ?? issue.fuelKind;
        const finalIssueDate = corr.newIssueDate ?? issue.issueDate;
        const finalLitres = corr.newLitres ?? issue.litres;

        // Re-resolve the pump price only when the date or fuel type changed;
        // otherwise keep the original snapshot and just rescale the total.
        let pricePerLitre = issue.pricePerLitre;
        let fuelPriceId = issue.fuelPriceId;
        if (corr.newFuelKind || corr.newIssueDate) {
          const resolved = await getPriceForDate(finalFuelKind, finalIssueDate);
          pricePerLitre = resolved.pricePerLitre;
          fuelPriceId = resolved.id;
        }
        const totalCost = Math.round(finalLitres * pricePerLitre);

        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: {
            litres: finalLitres,
            fuelKind: finalFuelKind,
            issueDate: finalIssueDate,
            pricePerLitre,
            fuelPriceId,
            totalCost,
            ...(corr.newMeterReading !== null ? { meterReading: corr.newMeterReading } : {}),
          },
        });

        // Keep the linked meter-reading record in step with a corrected reading.
        if (corr.newMeterReading !== null && issue.meterReadingRecordId) {
          await tx.meterReading.update({
            where: { id: issue.meterReadingRecordId },
            data: { value: corr.newMeterReading, readingDate: finalIssueDate },
          });
        }

        const parts: string[] = [];
        if (corr.newLitres !== null) parts.push(`litres ${corr.origLitres}→${corr.newLitres}`);
        if (corr.newMeterReading !== null) parts.push(`meter ${corr.origMeterReading ?? "—"}→${corr.newMeterReading}`);
        if (corr.newFuelKind) parts.push(`fuel ${corr.origFuelKind}→${corr.newFuelKind}`);
        if (corr.newIssueDate) parts.push(`date`);
        summary = `Corrected ${corr.assetCode} fuel issue (${corr.projectCode ?? "—"}): ${parts.join(", ")}`;
      }

      await tx.fuelIssueCorrection.update({
        where: { id: correctionId },
        data: { status: "APPROVED", reviewedById: admin.id, reviewedAt: new Date(), reviewNote },
      });

      await tx.auditLog.create({
        data: { actorId: admin.id, action: "APPROVE", entity: "FuelIssueCorrection", entityId: issue.id, summary },
      });
    });

    revalidatePath("/fuel/corrections");
    revalidatePath("/fuel/issues");
    revalidatePath("/billing");
    return { success: true };
  } catch (err: any) {
    console.error("Approve correction error:", err);
    return { error: err.message || "Failed to approve correction" };
  }
}

// Admin rejects a correction (no change to the issue).
export async function rejectCorrectionAction(correctionId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch {
    return { error: "You are not authorized to reject corrections" };
  }

  try {
    const corr = await prisma.fuelIssueCorrection.findUnique({ where: { id: correctionId } });
    if (!corr) return { error: "Correction not found" };
    if (corr.status !== "PENDING") return { error: "This correction has already been reviewed" };

    await prisma.fuelIssueCorrection.update({
      where: { id: correctionId },
      data: { status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date(), reviewNote },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "REJECT",
        entity: "FuelIssueCorrection",
        entityId: corr.fuelIssueId,
        summary: `Rejected ${corr.type} correction for ${corr.assetCode} (${corr.projectCode ?? "—"})${reviewNote ? `: ${reviewNote}` : ""}`,
      },
    });

    revalidatePath("/fuel/corrections");
    return { success: true };
  } catch (err: any) {
    console.error("Reject correction error:", err);
    return { error: err.message || "Failed to reject correction" };
  }
}
