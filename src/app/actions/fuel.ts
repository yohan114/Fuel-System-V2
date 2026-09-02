"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { canUserAccessAsset } from "@/lib/assignments";
import { isSiteUser } from "@/lib/roles";
import { getPriceForDate } from "@/lib/pricing";
import { checkDailyCap } from "@/lib/fuel-policy";
import { extractFileField } from "@/lib/upload";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { logFuelIssueChange, diffSnapshots, periodKeyFor } from "@/lib/fuel/audit";
import { colomboDayKey } from "@/lib/colombo-date";
import { checkFuelMeter } from "@/lib/fuel/meter-guard";

// How far back an admin may date a fuel issue before having to say why. A week
// covers the ordinary case — a site sends its sheets in on Monday — without
// letting a month be quietly rewritten.
const BACKDATE_FREE_DAYS = 7;

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

  // Fuel issuing is allowed 24/7 — the 08:00–17:00 time window was removed.
  // (Issue date/time, user, site, vehicle and issue person are still recorded.)

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
      // Site-scoped users (USER / SITE_PUMP) may only request fuel for vehicles
      // allocated to their site (legacy pin honored for never-assigned vehicles).
      // WORKSHOP is exempt — it can issue for any site / any vehicle.
      if (isSiteUser(user.role) && user.projectId) {
        const ok = await canUserAccessAsset(user, asset.id, new Date());
        if (!ok) {
          return { error: "This vehicle is not assigned to your site." };
        }
      }
    }

    if (meterReading !== null) {
      if (isNaN(meterReading) || meterReading < 0) {
        return { error: "Odometer/Hour reading must be a positive number" };
      }

      // Cumulative integrity, against this machine's own FUEL readings only.
      // Service meters are a different instrument and are excluded — see
      // src/lib/fuel/meter-guard.ts for why that mattered on 132 machines.
      const guard = await checkFuelMeter(prisma, asset.id, asset.meterType, meterReading, new Date());
      if (!guard.ok) return { error: guard.error! };
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
  } catch (err: unknown) {
    console.error("Submit request error:", err);
    return { error: errorMessage(err) || "Failed to submit request" };
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
          issuePerson: admin.name,
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
  } catch (err: unknown) {
    console.error("Approve request error:", err);
    return { error: errorMessage(err) || "Failed to approve request" };
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
  } catch (err: unknown) {
    console.error("Reject request error:", err);
    return { error: errorMessage(err) || "Failed to reject request" };
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
  let source = formData.get("source")?.toString() || "STATION";
  const dateStr = formData.get("issueDate")?.toString();
  // Which pump it came out of. Blank means a filling station or an external
  // purchase — real, and no tank to draw down.
  const bulkTankId = formData.get("bulkTankId")?.toString().trim() || null;
  const backdateReason = formData.get("backdateReason")?.toString().trim() || null;

  if (!assetId || !fuelKind || !litresStr || !dateStr) {
    return { error: "Please fill in all required fields" };
  }

  const litres = parseFloat(litresStr);
  const meterReading = meterReadingStr ? parseFloat(meterReadingStr) : null;
  const issueDate = new Date(dateStr);

  // How far back this may be dated.
  //
  // It used to be the current day and nothing else, which is right for an
  // operator at a pump and wrong for an office putting a week of paper sheets
  // into the system — the reason so much of this fleet's fuel arrives by bulk
  // import instead. An admin may date it back; past a week they say why, and
  // the reason goes on the record with everything else.
  if (process.env.TEST_ENV !== "true") {
    const colomboToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    const issueDay = colomboDayKey(issueDate);
    const isAdmin = admin.role === "ADMIN";

    if (issueDay > colomboToday) {
      return { error: "A fuel issue cannot be dated in the future." };
    }
    if (!isAdmin && issueDay !== colomboToday) {
      return { error: "You can only log operations for the current day." };
    }
    if (isAdmin) {
      const daysBack = Math.round(
        (new Date(`${colomboToday}T00:00:00+05:30`).getTime() - new Date(`${issueDay}T00:00:00+05:30`).getTime()) / 86_400_000,
      );
      if (daysBack > BACKDATE_FREE_DAYS && (backdateReason?.length ?? 0) < 4) {
        return {
          error: `That is ${daysBack} days back. Give a reason for dating it then — it goes on the record.`,
        };
      }
    }
  }

  // Fuel issuing is allowed 24/7 — the 08:00–17:00 time window was removed.
  // (Issue date/time, user, site, vehicle and issue person are still recorded.)

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

      // Cumulative integrity, against this machine's own FUEL readings only.
      // Service meters are a different instrument and are excluded — see
      // src/lib/fuel/meter-guard.ts for why that mattered on 132 machines.
      const guard = await checkFuelMeter(prisma, asset.id, asset.meterType, meterReading, issueDate);
      if (!guard.ok) return { error: guard.error! };
    }

    // Site fuel discipline: block if this would exceed the vehicle's daily cap.
    const capError = await checkDailyCap(asset.id, asset.dailyCapLitres, issueDate, litres);
    if (capError) return { error: capError };

    // The pump, where one was named. Litres out of a tank must come off its
    // balance or the stock figure drifts from what was actually dispensed —
    // which is how this database came to read 7,856 L at Badalgama against the
    // site instance's 727 L.
    let tank: { id: string; name: string; balance: number; fuelKind: string } | null = null;
    if (bulkTankId) {
      tank = await prisma.bulkTank.findUnique({
        where: { id: bulkTankId },
        select: { id: true, name: true, balance: true, fuelKind: true },
      });
      if (!tank) return { error: "That pump was not found" };
      if (tank.fuelKind !== fuelKind) {
        return { error: `${tank.name} holds ${tank.fuelKind.replace(/_/g, " ").toLowerCase()}, not ${fuelKind.replace(/_/g, " ").toLowerCase()}.` };
      }
      if (tank.balance < litres) {
        return { error: `${tank.name} holds ${tank.balance.toFixed(1)} L — less than the ${litres} L being issued.` };
      }
      // Same convention as the operator consoles: the pump's name IS the source.
      source = tank.name;
    }

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
          issuePerson: admin.name,
          fuelPriceId: resolvedPrice.id,
          bulkTankId: tank?.id ?? null,
          ...(photo ? { photoData: photo.data, photoName: photo.name, photoMime: photo.mime } : {}),
        },
      });

      if (tank) {
        await tx.bulkTank.update({
          where: { id: tank.id },
          data: { balance: { decrement: litres } },
        });
      }

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

      await logFuelIssueChange(tx, admin.id, asset.code, {
        action: "CREATE",
        issueId: issue.id,
        // A creation has no "before", so the fields are recorded as arrivals
        // rather than as movements.
        changes: [
          { field: "litres", from: null, to: litres },
          { field: "fuelKind", from: null, to: fuelKind },
          { field: "pricePerLitre", from: null, to: resolvedPrice.pricePerLitre },
          { field: "totalCost", from: null, to: totalCost },
          { field: "source", from: null, to: source },
          { field: "issueDate", from: null, to: issueDate.toISOString() },
          ...(meterReading !== null ? [{ field: "meterReading", from: null, to: meterReading }] : []),
        ],
        tankDeltaLitres: tank ? -litres : undefined,
        tankId: tank?.id ?? null,
        tankName: tank?.name ?? null,
        meterReading: meterReading !== null ? "created" : "unchanged",
        periodKey: periodKeyFor(issueDate),
        reason: backdateReason,
      });
    });

    revalidatePath("/");
    revalidatePath("/fuel/issues");
    revalidatePath(`/fleet/${asset.code}`);
    // The pump consoles show a balance this has just moved.
    if (tank) {
      revalidatePath("/workshop");
      revalidatePath("/site");
    }
    return {
      success: true,
      message:
        `Recorded ${litres} L for ${asset.code}` +
        (tank ? ` from ${tank.name} — balance now ${(tank.balance - litres).toFixed(1)} L.` : " (station / external purchase)."),
    };
  } catch (err: unknown) {
    console.error("Record direct issue error:", err);
    return { error: errorMessage(err) || "Failed to record fuel issue" };
  }
}

// 5. Edit Fuel Issue (Admin only)
export async function editFuelIssueAction(issueId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
    if (admin.role !== "ADMIN") {
      return { error: "You are not authorized to perform this action" };
    }
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const assetCode = formData.get("assetCode")?.toString().trim();
  const litresStr = formData.get("litres")?.toString();
  const meterReadingStr = formData.get("meterReading")?.toString();
  const dateStr = formData.get("issueDate")?.toString();
  let fuelKind = formData.get("fuelKind")?.toString();
  const source = formData.get("source")?.toString() || "STATION";
  // Free text, and worth having: the numbers say what moved, not why.
  const reason = formData.get("reason")?.toString().trim() || null;

  if (!issueId || !assetCode || !litresStr || !dateStr) {
    return { error: "Please fill in all required fields" };
  }

  const litres = parseFloat(litresStr);
  const meterReading = meterReadingStr && meterReadingStr.trim() !== "" ? parseFloat(meterReadingStr) : null;
  const issueDate = new Date(dateStr);

  if (isNaN(litres) || litres <= 0) {
    return { error: "Litres must be greater than zero" };
  }

  if (isNaN(issueDate.getTime())) {
    return { error: "Invalid issue date" };
  }

  try {
    // 1. Fetch the existing issue
    const oldIssue = await prisma.fuelIssue.findUnique({
      where: { id: issueId },
      include: { asset: true, bulkTank: true },
    });

    if (!oldIssue) {
      return { error: "Fuel issue not found" };
    }

    if (!fuelKind) {
      fuelKind = oldIssue.fuelKind;
    }

    // 2. Resolve asset (create if it doesn't exist under OTHER category)
    let asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { code: assetCode.toUpperCase() },
          { regNo: assetCode.toUpperCase() }
        ]
      }
    });

    if (!asset) {
      const otherCategory = await prisma.category.findFirst({
        where: { code: "OTHER" },
      });
      if (!otherCategory) {
        return { error: "Fallback asset category 'OTHER' is missing from the database" };
      }
      asset = await prisma.asset.create({
        data: {
          code: assetCode.toUpperCase(),
          categoryId: otherCategory.id,
          meterType: "KM",
          status: "ACTIVE",
          brand: "Quick Added",
          typeLabel: "Other Asset",
        }
      });
    }

    // Check meter reading positive value if supplied
    if (meterReading !== null && (isNaN(meterReading) || meterReading < 0)) {
      return { error: "Meter reading must be a positive number" };
    }

    // 3. Handle bulk tank adjustment if it is linked to a bulk tank
    let bulkTankToUpdate: any = null;
    let balanceChange = 0; // how much we add back to the tank balance

    if (oldIssue.bulkTankId) {
      const tank = await prisma.bulkTank.findUnique({
        where: { id: oldIssue.bulkTankId },
      });
      if (!tank) {
        return { error: "Linked bulk tank was not found" };
      }

      // Check if fuel kind matches the bulk tank
      if (fuelKind !== tank.fuelKind) {
        return { error: `Fuel kind cannot be changed for issue linked to bulk tank "${tank.name}" (${tank.fuelKind})` };
      }

      // Calculate how much fuel we are returning / taking extra
      balanceChange = oldIssue.litres - litres;

      // If we are drawing MORE fuel, check if the tank has enough balance
      if (balanceChange < 0 && tank.balance < Math.abs(balanceChange)) {
        return {
          error: `Insufficient fuel in ${tank.name}. Available balance: ${tank.balance.toFixed(1)}L, additional requested: ${Math.abs(balanceChange).toFixed(1)}L.`
        };
      }

      bulkTankToUpdate = tank;
    }

    // 4. Resolve the fuel price for the new date & fuel kind
    const resolvedPrice = await getPriceForDate(fuelKind, issueDate);
    const totalCost = Math.round(litres * resolvedPrice.pricePerLitre);

    // 5. Update inside transaction
    await prisma.$transaction(async (tx) => {
      // Update bulk tank balance if needed
      if (bulkTankToUpdate && balanceChange !== 0) {
        await tx.bulkTank.update({
          where: { id: bulkTankToUpdate.id },
          data: {
            balance: {
              increment: balanceChange
            }
          }
        });
      }

      // Update or create linked MeterReading record
      let meterReadingRecordId = oldIssue.meterReadingRecordId;
      // Tracked for the audit entry: a litre changing hands moves a meter row
      // as well as a tank balance, and the record should say which.
      let meterOutcome: "created" | "updated" | "deleted" | "unchanged" = "unchanged";

      if (meterReading !== null) {
        if (meterReadingRecordId) {
          // Update existing meter reading
          await tx.meterReading.update({
            where: { id: meterReadingRecordId },
            data: {
              value: meterReading,
              readingType: asset.meterType, // use the (possibly updated) asset's meter type
              readingDate: issueDate,
              assetId: asset.id, // in case asset changed
            }
          });
          meterOutcome = "updated";
        } else {
          // Create new meter reading record
          const newReading = await tx.meterReading.create({
            data: {
              assetId: asset.id,
              value: meterReading,
              readingType: asset.meterType,
              readingDate: issueDate,
              source: "FUEL_ISSUE",
              recordedById: admin.id,
              linkedIssueId: oldIssue.id,
            }
          });
          meterReadingRecordId = newReading.id;
          meterOutcome = "created";
        }
      } else {
        // If they cleared the reading but there was one before, delete it
        if (meterReadingRecordId) {
          // Unlink first
          await tx.fuelIssue.update({
            where: { id: issueId },
            data: {
              meterReadingRecordId: null
            }
          });
          // Delete
          await tx.meterReading.delete({
            where: { id: meterReadingRecordId }
          });
          meterReadingRecordId = null;
          meterOutcome = "deleted";
        }
      }

      // Update FuelIssue
      await tx.fuelIssue.update({
        where: { id: issueId },
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
          fuelPriceId: resolvedPrice.id,
          meterReadingRecordId,
        }
      });

      // The record. Every field that moved with both its values, plus what the
      // change did to the tank, the meter row and the month's bill — the old
      // entry named three of the eleven fields it could change and no
      // consequence at all.
      await logFuelIssueChange(tx, admin.id, asset.code, {
        action: "UPDATE",
        issueId: oldIssue.id,
        changes: diffSnapshots(
          {
            assetId: oldIssue.assetId, assetCode: oldIssue.asset.code, fuelKind: oldIssue.fuelKind,
            litres: oldIssue.litres, meterReading: oldIssue.meterReading, readingType: oldIssue.readingType,
            pricePerLitre: oldIssue.pricePerLitre, totalCost: oldIssue.totalCost, source: oldIssue.source,
            issueDate: oldIssue.issueDate, bulkTankId: oldIssue.bulkTankId, voided: oldIssue.voided,
          },
          {
            // `fuelKind` is a `let` that defaults to the old value earlier; the
            // narrowing does not survive into this callback, so it is restated.
            assetId: asset.id, assetCode: asset.code, fuelKind: fuelKind ?? oldIssue.fuelKind,
            litres, meterReading, readingType: asset.meterType,
            pricePerLitre: resolvedPrice.pricePerLitre, totalCost, source,
            issueDate, bulkTankId: oldIssue.bulkTankId, voided: oldIssue.voided,
          },
        ),
        tankDeltaLitres: balanceChange || undefined,
        tankId: bulkTankToUpdate?.id ?? null,
        tankName: bulkTankToUpdate?.name ?? null,
        meterReading: meterOutcome,
        // Both months where an edit moved the issue across a month boundary,
        // since both bills have to be redone.
        periodKey:
          periodKeyFor(oldIssue.issueDate) === periodKeyFor(issueDate)
            ? periodKeyFor(issueDate)
            : `${periodKeyFor(oldIssue.issueDate)} → ${periodKeyFor(issueDate)}`,
        reason,
      });
    });

    revalidatePath("/");
    revalidatePath("/fuel/issues");
    revalidatePath(`/fleet/${oldIssue.asset.code}`);
    revalidatePath(`/fleet/${asset.code}`);
    if (oldIssue.bulkTankId) {
      revalidatePath("/workshop");
    }

    return { success: true };
  } catch (err: any) {
    console.error("Edit fuel issue error:", err);
    return { error: err.message || "Failed to update fuel issue" };
  }
}

