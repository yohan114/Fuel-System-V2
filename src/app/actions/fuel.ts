"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { canUserAccessAsset } from "@/lib/assignments";
import { getPriceForDate } from "@/lib/pricing";
import { checkDailyCap } from "@/lib/fuel-policy";
import { extractFileField } from "@/lib/upload";
import { revalidatePath } from "next/cache";

// Site-configurable gate: when Setting "fuel_photo_required" === "true", a
// pump/meter photo must accompany every fuel request / direct issue.
async function photoRequired(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: "fuel_photo_required" } });
  return s?.value === "true";
}

// 1. Submit Request (User/Admin)
export async function submitRequestAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  // Time Lock check
  if (process.env.TEST_ENV !== "true") {
    const colomboHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10
    );
    if (colomboHour < 8 || colomboHour >= 17) {
      return { error: "Fuel operations are only allowed between 08:00 AM and 17:00 PM." };
    }
  }

  const assetId = formData.get("assetId")?.toString();
  const fuelKind = formData.get("fuelKind")?.toString();
  const requestedLitresStr = formData.get("requestedLitres")?.toString();
  const meterReadingStr = formData.get("meterReading")?.toString();
  const reason = formData.get("reason")?.toString() || null;

  if (!assetId || !fuelKind || !requestedLitresStr) {
    return { error: "Please fill in all required fields" };
  }

  const requestedLitres = parseFloat(requestedLitresStr);
  const meterReading = meterReadingStr ? parseFloat(meterReadingStr) : null;

  if (isNaN(requestedLitres) || requestedLitres <= 0) {
    return { error: "Requested litres must be greater than zero" };
  }

  try {
    let asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { id: assetId },
          { code: assetId.trim().toUpperCase() },
          { regNo: assetId.trim().toUpperCase() }
        ]
      }
    });

    if (!asset) {
      // Auto-create under fallback category
      const otherCategory = await prisma.category.findFirst({
        where: { code: "OTHER" },
      });
      if (!otherCategory) {
        return { error: "Fallback asset category 'OTHER' is missing from the database" };
      }
      asset = await prisma.asset.create({
        data: {
          code: assetId.trim().toUpperCase(),
          categoryId: otherCategory.id,
          meterType: "KM",
          status: "ACTIVE",
          brand: "Quick Added",
          typeLabel: "Other Asset",
          projectId: user.projectId || null, // Auto-bind new asset to user's project
        }
      });
    } else {
      // Project-scoped users may only request fuel for vehicles assigned to
      // their site today (legacy pin honored for never-assigned vehicles).
      if (user.role === "USER" && user.projectId) {
        const ok = await canUserAccessAsset(user, asset.id, new Date());
        if (!ok) {
          return { error: "This vehicle is not assigned to your site today." };
        }
      }
    }

    if (meterReading !== null) {
      if (isNaN(meterReading) || meterReading < 0) {
        return { error: "Odometer/Hour reading must be a positive number" };
      }

      // Check cumulative integrity
      const latestReading = await prisma.meterReading.findFirst({
        where: { assetId: asset.id, readingType: asset.meterType },
        orderBy: [{ value: "desc" }, { readingDate: "desc" }],
      });

      if (latestReading && meterReading < latestReading.value) {
        return {
          error: `Reading value (${meterReading}) is lower than current reading (${latestReading.value}). Readings cannot go backwards.`,
        };
      }
    }

    const photo = await extractFileField(formData, "photo");
    if (!photo && (await photoRequired())) {
      return { error: "A pump/meter photo is required to submit a fuel request." };
    }

    const request = await prisma.fuelRequest.create({
      data: {
        assetId: asset.id,
        fuelKind,
        requestedLitres,
        meterReading,
        readingType: asset.meterType,
        reason,
        status: "PENDING",
        requestedById: user.id,
        ...(photo ? { photoData: photo.data, photoName: photo.name, photoMime: photo.mime } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entity: "FuelRequest",
        entityId: request.id,
        summary: `Submitted request for ${requestedLitres}L of ${fuelKind} for ${asset.code}`,
      },
    });

    revalidatePath("/");
    revalidatePath("/fuel/requests");
    return { success: true };
  } catch (err: any) {
    console.error("Submit request error:", err);
    return { error: err.message || "Failed to submit request" };
  }
}

// 2. Approve Request (Admin only)
export async function approveRequestAction(requestId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const request = await prisma.fuelRequest.findUnique({
      where: { id: requestId },
      include: { asset: true },
    });

    if (!request) {
      return { error: "Request does not exist" };
    }

    if (request.status !== "PENDING") {
      return { error: "Request has already been processed" };
    }

    // Resolve active price for the current date
    const issueDate = new Date();

    // Site fuel discipline: block if this would exceed the vehicle's daily cap.
    const capError = await checkDailyCap(
      request.assetId,
      request.asset.dailyCapLitres,
      issueDate,
      request.requestedLitres
    );
    if (capError) return { error: capError };
    const resolvedPrice = await getPriceForDate(request.fuelKind, issueDate);
    const totalCost = Math.round(request.requestedLitres * resolvedPrice.pricePerLitre);

    await prisma.$transaction(async (tx) => {
      // Create the FuelIssue
      const issue = await tx.fuelIssue.create({
        data: {
          assetId: request.assetId,
          fuelKind: request.fuelKind,
          litres: request.requestedLitres,
          meterReading: request.meterReading,
          readingType: request.readingType,
          pricePerLitre: resolvedPrice.pricePerLitre,
          totalCost,
          source: "STATION",
          issueDate,
          issuedById: admin.id,
          linkedRequestId: request.id,
          fuelPriceId: resolvedPrice.id,
          ...(request.photoData
            ? { photoData: request.photoData, photoName: request.photoName, photoMime: request.photoMime }
            : {}),
        },
      });

      // Update FuelRequest status to APPROVED
      await tx.fuelRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          reviewedById: admin.id,
          reviewedAt: issueDate,
          reviewNote,
        },
      });

      // If a meter reading was supplied, write it as a formal MeterReading record
      if (request.meterReading !== null) {
        const reading = await tx.meterReading.create({
          data: {
            assetId: request.assetId,
            value: request.meterReading,
            readingType: request.readingType!,
            readingDate: issueDate,
            source: "FUEL_ISSUE",
            recordedById: admin.id,
            linkedIssueId: issue.id,
          },
        });

        // Link the issue back to the created reading record
        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: {
            meterReadingRecordId: reading.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "APPROVE",
          entity: "FuelRequest",
          entityId: request.id,
          summary: `Approved request ${request.id} for asset ${request.asset.code}. Dispatched ${request.requestedLitres}L at Rs. ${resolvedPrice.pricePerLitre / 100}/L.`,
        },
      });
    });

    revalidatePath("/");
    revalidatePath("/fuel/requests");
    revalidatePath("/fuel/issues");
    revalidatePath(`/fleet/${request.asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Approve request error:", err);
    return { error: err.message || "Failed to approve request" };
  }
}

// 3. Reject Request (Admin only)
export async function rejectRequestAction(requestId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const request = await prisma.fuelRequest.findUnique({
      where: { id: requestId },
      include: { asset: true },
    });

    if (!request) {
      return { error: "Request does not exist" };
    }

    if (request.status !== "PENDING") {
      return { error: "Request has already been processed" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.fuelRequest.update({
        where: { id: requestId },
        data: {
          status: "REJECTED",
          reviewedById: admin.id,
          reviewedAt: new Date(),
          reviewNote,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "REJECT",
          entity: "FuelRequest",
          entityId: request.id,
          summary: `Rejected request ${request.id} for asset ${request.asset.code} with note: ${reviewNote || "none"}`,
        },
      });
    });

    revalidatePath("/");
    revalidatePath("/fuel/requests");
    return { success: true };
  } catch (err: any) {
    console.error("Reject request error:", err);
    return { error: err.message || "Failed to reject request" };
  }
}

// 4. Record Direct Issue (Admin only)
export async function recordDirectIssueAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("approve"); // Direct issues require admin approval rights
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const assetId = formData.get("assetId")?.toString();
  const fuelKind = formData.get("fuelKind")?.toString();
  const litresStr = formData.get("litres")?.toString();
  const meterReadingStr = formData.get("meterReading")?.toString();
  const source = formData.get("source")?.toString() || "STATION";
  const dateStr = formData.get("issueDate")?.toString();

  if (!assetId || !fuelKind || !litresStr || !dateStr) {
    return { error: "Please fill in all required fields" };
  }

  const litres = parseFloat(litresStr);
  const meterReading = meterReadingStr ? parseFloat(meterReadingStr) : null;
  const issueDate = new Date(dateStr);

  // Date Lock check (current day only)
  if (process.env.TEST_ENV !== "true") {
    const colomboTodayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    const issueDatePart = dateStr.split("T")[0];
    if (issueDatePart !== colomboTodayStr) {
      return { error: "You can only log operations for the current day." };
    }
  }

  // Time Lock check
  if (process.env.TEST_ENV !== "true") {
    const colomboHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10
    );
    if (colomboHour < 8 || colomboHour >= 17) {
      return { error: "Fuel operations are only allowed between 08:00 AM and 17:00 PM." };
    }
  }

  if (isNaN(litres) || litres <= 0) {
    return { error: "Litres must be greater than zero" };
  }

  try {
    let asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { id: assetId },
          { code: assetId.trim().toUpperCase() },
          { regNo: assetId.trim().toUpperCase() }
        ]
      }
    });

    if (!asset) {
      // Auto-create under fallback category
      const otherCategory = await prisma.category.findFirst({
        where: { code: "OTHER" },
      });
      if (!otherCategory) {
        return { error: "Fallback asset category 'OTHER' is missing from the database" };
      }
      asset = await prisma.asset.create({
        data: {
          code: assetId.trim().toUpperCase(),
          categoryId: otherCategory.id,
          meterType: "KM",
          status: "ACTIVE",
          brand: "Quick Added",
          typeLabel: "Other Asset",
        }
      });
    }

    if (meterReading !== null) {
      if (isNaN(meterReading) || meterReading < 0) {
        return { error: "Meter reading must be positive" };
      }

      // Check cumulative integrity
      const latestReading = await prisma.meterReading.findFirst({
        where: { assetId: asset.id, readingType: asset.meterType },
        orderBy: [{ value: "desc" }, { readingDate: "desc" }],
      });

      if (latestReading && meterReading < latestReading.value) {
        return {
          error: `Reading value (${meterReading}) is lower than the current reading (${latestReading.value}). Readings cannot go backwards.`,
        };
      }
    }

    // Site fuel discipline: block if this would exceed the vehicle's daily cap.
    const capError = await checkDailyCap(asset.id, asset.dailyCapLitres, issueDate, litres);
    if (capError) return { error: capError };

    const photo = await extractFileField(formData, "photo");
    if (!photo && (await photoRequired())) {
      return { error: "A pump/meter photo is required to record a fuel issue." };
    }

    // Resolve price for the date of issue
    const resolvedPrice = await getPriceForDate(fuelKind, issueDate);
    const totalCost = Math.round(litres * resolvedPrice.pricePerLitre);

    await prisma.$transaction(async (tx) => {
      // Create issue
      const issue = await tx.fuelIssue.create({
        data: {
          assetId: asset.id,
          fuelKind,
          litres,
          meterReading,
          readingType: asset.meterType,
          pricePerLitre: resolvedPrice.pricePerLitre,
          totalCost,
          source,
          issueDate,
          issuedById: admin.id,
          fuelPriceId: resolvedPrice.id,
          ...(photo ? { photoData: photo.data, photoName: photo.name, photoMime: photo.mime } : {}),
        },
      });

      // Log meter reading if provided
      if (meterReading !== null) {
        const reading = await tx.meterReading.create({
          data: {
            assetId: asset.id,
            value: meterReading,
            readingType: asset.meterType,
            readingDate: issueDate,
            source: "FUEL_ISSUE",
            recordedById: admin.id,
            linkedIssueId: issue.id,
          },
        });

        // Update issue reference
        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: {
            meterReadingRecordId: reading.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "CREATE",
          entity: "FuelIssue",
          entityId: issue.id,
          summary: `Recorded direct issue of ${litres}L of ${fuelKind} for asset ${asset.code} at Rs. ${resolvedPrice.pricePerLitre / 100}/L.`,
        },
      });
    });

    revalidatePath("/");
    revalidatePath("/fuel/issues");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true };
  } catch (err: any) {
    console.error("Record direct issue error:", err);
    return { error: err.message || "Failed to record fuel issue" };
  }
}
