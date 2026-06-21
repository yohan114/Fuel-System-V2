"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { getPriceForDate } from "@/lib/pricing";
import { extractFileField } from "@/lib/upload";

// 1. Create Bulk Tank (Admin only)
export async function createBulkTankAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const name = formData.get("name")?.toString().trim();
  const fuelKind = formData.get("fuelKind")?.toString().trim();
  const capacityStr = formData.get("capacity")?.toString();
  const initialBalanceStr = formData.get("initialBalance")?.toString() || "0";
  const projectId = formData.get("projectId")?.toString() || null;

  if (!name || !fuelKind || !capacityStr) {
    return { error: "Please fill in all required fields" };
  }

  const capacity = parseFloat(capacityStr);
  const initialBalance = parseFloat(initialBalanceStr);

  if (isNaN(capacity) || capacity <= 0) {
    return { error: "Capacity must be greater than zero" };
  }
  if (isNaN(initialBalance) || initialBalance < 0) {
    return { error: "Initial balance cannot be negative" };
  }

  try {
    const existing = await prisma.bulkTank.findUnique({
      where: { name },
    });
    if (existing) {
      return { error: `Tank name "${name}" is already in use` };
    }

    const tank = await prisma.bulkTank.create({
      data: {
        name,
        fuelKind,
        capacity,
        balance: initialBalance,
        projectId: projectId || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "BulkTank",
        entityId: tank.id,
        summary: `Created bulk tank "${name}" with capacity ${capacity}L and balance ${initialBalance}L, associated with projectId "${projectId || "none"}"`,
      },
    });

    revalidatePath("/admin/projects");
    return { success: true };
  } catch (err: any) {
    console.error("Create bulk tank error:", err);
    return { error: err.message || "Failed to create bulk tank" };
  }
}

// 1.5. Update Bulk Tank (Admin only)
export async function updateBulkTankAction(bulkTankId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const name = formData.get("name")?.toString().trim();
  const fuelKind = formData.get("fuelKind")?.toString().trim();
  const capacityStr = formData.get("capacity")?.toString();
  const projectId = formData.get("projectId")?.toString() || null;

  if (!name || !fuelKind || !capacityStr) {
    return { error: "Please fill in all required fields" };
  }

  const capacity = parseFloat(capacityStr);
  if (isNaN(capacity) || capacity <= 0) {
    return { error: "Capacity must be greater than zero" };
  }

  try {
    const existing = await prisma.bulkTank.findFirst({
      where: {
        name,
        id: { not: bulkTankId },
      },
    });
    if (existing) {
      return { error: `Another tank named "${name}" is already in use` };
    }

    const tank = await prisma.bulkTank.update({
      where: { id: bulkTankId },
      data: {
        name,
        fuelKind,
        capacity,
        projectId: projectId || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "BulkTank",
        entityId: tank.id,
        summary: `Updated bulk tank "${name}" details: fuelKind="${fuelKind}", capacity=${capacity}L, projectId="${projectId || "none"}"`,
      },
    });

    revalidatePath("/admin/projects");
    revalidatePath("/workshop");
    return { success: true };
  } catch (err: any) {
    console.error("Update bulk tank error:", err);
    return { error: err.message || "Failed to update bulk tank" };
  }
}

// 2. Submit Bulk Replenishment Request (Workshop user/Admin)
export async function submitBulkRequestAction(formData: FormData) {
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

  const bulkTankId = formData.get("bulkTankId")?.toString();
  const requestedLitresStr = formData.get("requestedLitres")?.toString();

  if (!bulkTankId || !requestedLitresStr) {
    return { error: "Please fill in all required fields" };
  }

  const requestedLitres = parseFloat(requestedLitresStr);
  if (isNaN(requestedLitres) || requestedLitres <= 0) {
    return { error: "Requested litres must be greater than zero" };
  }

  try {
    const tank = await prisma.bulkTank.findUnique({
      where: { id: bulkTankId },
    });
    if (!tank) {
      return { error: "Storage tank not found" };
    }

    const req = await prisma.bulkRequest.create({
      data: {
        bulkTankId: tank.id,
        fuelKind: tank.fuelKind,
        requestedLitres,
        requestedById: user.id,
        status: "PENDING",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entity: "BulkRequest",
        entityId: req.id,
        summary: `Requested replenishment of ${requestedLitres}L of ${tank.fuelKind} for ${tank.name}`,
      },
    });

    revalidatePath("/workshop");
    return { success: true };
  } catch (err: any) {
    console.error("Submit bulk request error:", err);
    return { error: err.message || "Failed to submit request" };
  }
}

// 3. Approve Bulk Replenishment Request (Admin only)
export async function approveBulkRequestAction(requestId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const req = await prisma.bulkRequest.findUnique({
      where: { id: requestId },
      include: { bulkTank: true },
    });

    if (!req) {
      return { error: "Request not found" };
    }

    if (req.status !== "PENDING") {
      return { error: "Request has already been processed" };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Set request status to APPROVED
      await tx.bulkRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          reviewedById: admin.id,
          reviewedAt: new Date(),
          reviewNote,
        },
      });

      // Check if target is the main pump (Badalgama Main pump)
      const isMainPump = req.bulkTank.name.toLowerCase().includes("badalgama") && 
                         req.bulkTank.name.toLowerCase().includes("main");

      if (isMainPump) {
        // Direct refuel for main pump
        await tx.bulkTank.update({
          where: { id: req.bulkTankId },
          data: {
            balance: {
              increment: req.requestedLitres,
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: requestId,
            summary: `Approved bulk delivery of ${req.requestedLitres}L to Main Pump "${req.bulkTank.name}"`,
          },
        });
      } else {
        // Site tank refuel: draw from the Badalgama Main pump for the same fuel kind
        const allTanks = await tx.bulkTank.findMany();
        const mainPump = allTanks.find(t => 
          t.name.toLowerCase().includes("badalgama") && 
          t.name.toLowerCase().includes("main") && 
          t.fuelKind === req.fuelKind
        );

        if (!mainPump) {
          throw new Error(`Main source pump in Badalgama for ${req.fuelKind.replace("_", " ")} was not found.`);
        }

        if (mainPump.balance < req.requestedLitres) {
          throw new Error(`Insufficient fuel in Badalgama Main Pump (${mainPump.name}). Available: ${mainPump.balance.toFixed(1)}L, requested: ${req.requestedLitres}L.`);
        }

        // Deduct from Main Pump
        await tx.bulkTank.update({
          where: { id: mainPump.id },
          data: {
            balance: {
              decrement: req.requestedLitres,
            },
          },
        });

        // Increment target tank balance
        await tx.bulkTank.update({
          where: { id: req.bulkTankId },
          data: {
            balance: {
              increment: req.requestedLitres,
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: requestId,
            summary: `Approved bulk fuel transfer of ${req.requestedLitres}L from "${mainPump.name}" to "${req.bulkTank.name}"`,
          },
        });
      }
    });

    try {
      revalidatePath("/admin/projects");
      revalidatePath("/workshop");
    } catch (e) {
      // Ignore Next.js runtime static generation store errors in CLI tests
    }
    return { success: true };
  } catch (err: any) {
    console.error("Approve bulk request error:", err);
    return { error: err.message || "Failed to approve request" };
  }
}

// 4. Reject Bulk Replenishment Request (Admin only)
export async function rejectBulkRequestAction(requestId: string, reviewNote: string | null) {
  let admin;
  try {
    admin = await assertCan("approve");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const req = await prisma.bulkRequest.findUnique({
      where: { id: requestId },
    });

    if (!req) {
      return { error: "Request not found" };
    }

    if (req.status !== "PENDING") {
      return { error: "Request has already been processed" };
    }

    await prisma.bulkRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewedById: admin.id,
        reviewedAt: new Date(),
        reviewNote,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "REJECT",
        entity: "BulkRequest",
        entityId: requestId,
        summary: `Rejected bulk fuel request for ${req.requestedLitres}L`,
      },
    });

    revalidatePath("/admin/projects");
    revalidatePath("/workshop");
    return { success: true };
  } catch (err: any) {
    console.error("Reject bulk request error:", err);
    return { error: err.message || "Failed to reject request" };
  }
}

// 5. Issue Fuel drawing from local BulkTank balance
export async function workshopIssueFuelAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  if (user.role !== "WORKSHOP" || !user.bulkTankId) {
    return { error: "Only accounts with a linked workshop pump can issue fuel from bulk." };
  }

  const assetId = formData.get("assetId")?.toString();
  const litresStr = formData.get("litres")?.toString();
  const meterReadingStr = formData.get("meterReading")?.toString();
  const reason = formData.get("reason")?.toString() || null;
  const projectId = formData.get("projectId")?.toString() || null;
  const issueDateStr = formData.get("issueDate")?.toString() || null;

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
      if (reason !== "Vehicle Breakdown" && reason !== "Active Night Work") {
        return { error: "During locked hours (17:00 PM - 08:00 AM), fuel issues are only allowed for 'Vehicle Breakdown' or 'Active Night Work'. Please select a valid reason." };
      }
    }
  }

  if (!assetId || !litresStr) {
    return { error: "Asset Code and Litres are required." };
  }

  const litres = parseFloat(litresStr);
  const meterReading = meterReadingStr ? parseFloat(meterReadingStr) : null;

  if (isNaN(litres) || litres <= 0) {
    return { error: "Litres issued must be greater than zero." };
  }

  let issueDate = new Date();
  if (issueDateStr) {
    const parsedDate = new Date(issueDateStr);
    if (isNaN(parsedDate.getTime())) {
      return { error: "Invalid date format." };
    }

    const now = new Date();
    const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d2 = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
    const diffTime = d1.getTime() - d2.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { error: "Selected date cannot be in the future." };
    }
    if (diffDays > 14) {
      return { error: "Backdated dispatches are only allowed up to 14 days in the past." };
    }

    // Preserve hour/minute/second of submission
    issueDate = new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds()
    );
  }

  try {
    // 1. Fetch current tank balance
    const tank = await prisma.bulkTank.findUnique({
      where: { id: user.bulkTankId },
    });

    if (!tank) {
      return { error: "Your linked pump storage tank was not found." };
    }

    if (tank.balance < litres) {
      return {
        error: `Insufficient fuel in ${tank.name}. Available: ${tank.balance.toFixed(1)}L, attempting to issue: ${litres}L.`,
      };
    }

    // 2. Fetch or create asset (supporting typing on-the-fly)
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
      const otherCategory = await prisma.category.findFirst({
        where: { code: "OTHER" },
      });
      if (!otherCategory) {
        return { error: "Default category 'OTHER' is missing." };
      }
      
      const isSiteAsset = assetId.trim().toUpperCase().startsWith("SITE-");
      
      asset = await prisma.asset.create({
        data: {
          code: assetId.trim().toUpperCase(),
          categoryId: otherCategory.id,
          projectId: projectId || null,
          meterType: "KM",
          status: "ACTIVE",
          brand: isSiteAsset ? "Site Storage" : "Quick Added",
          typeLabel: isSiteAsset ? "Project Site" : "Other Asset",
        }
      });
    } else if (projectId && !asset.projectId) {
      asset = await prisma.asset.update({
        where: { id: asset.id },
        data: { projectId }
      });
    }

    if (meterReading !== null) {
      if (isNaN(meterReading) || meterReading < 0) {
        return { error: "Odometer/Hour reading must be a positive number." };
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

    // Optional pump/meter photo proof.
    const photo = await extractFileField(formData, "photo");

    // Resolve price and cost based on custom issueDate
    const resolvedPrice = await getPriceForDate(tank.fuelKind, issueDate);
    const totalCost = Math.round(litres * resolvedPrice.pricePerLitre);

    // Write in transaction
    await prisma.$transaction(async (tx) => {
      // A. Create standard FuelIssue
      const issue = await tx.fuelIssue.create({
        data: {
          assetId: asset.id,
          fuelKind: tank.fuelKind,
          litres,
          meterReading,
          readingType: asset.meterType,
          pricePerLitre: resolvedPrice.pricePerLitre,
          totalCost,
          source: tank.name,
          issueDate,
          issuedById: user.id,
          fuelPriceId: resolvedPrice.id,
          bulkTankId: tank.id,
          ...(photo ? { photoData: photo.data, photoName: photo.name, photoMime: photo.mime } : {}),
        },
      });

      // B. Decrement tank balance
      await tx.bulkTank.update({
        where: { id: tank.id },
        data: {
          balance: {
            decrement: litres,
          },
        },
      });

      // C. Record meter reading if provided
      if (meterReading !== null) {
        const reading = await tx.meterReading.create({
          data: {
            assetId: asset.id,
            value: meterReading,
            readingType: asset.meterType,
            readingDate: issueDate,
            source: "FUEL_ISSUE",
            recordedById: user.id,
            linkedIssueId: issue.id,
          },
        });

        await tx.fuelIssue.update({
          where: { id: issue.id },
          data: {
            meterReadingRecordId: reading.id,
          },
        });
      }

      // D. Log audit
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entity: "FuelIssue",
          entityId: issue.id,
          summary: `Workshop Pump issued ${litres}L of ${tank.fuelKind} to ${asset.code} (Deducted from ${tank.name})`,
        },
      });
    });

    revalidatePath("/workshop");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/fuel/issues");
    return { success: true };
  } catch (err: any) {
    console.error("Workshop issue fuel error:", err);
    return { error: err.message || "Failed to log fuel dispatch." };
  }
}

// 6. Delete Bulk Tank (Admin only)
export async function deleteBulkTankAction(bulkTankId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const tank = await prisma.bulkTank.findUnique({
      where: { id: bulkTankId },
    });

    if (!tank) {
      return { error: "Storage pump not found" };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Unlink users
      await tx.user.updateMany({
        where: { bulkTankId },
        data: { bulkTankId: null },
      });

      // 2. Delete related bulk replenishment requests
      await tx.bulkRequest.deleteMany({
        where: { bulkTankId },
      });

      // 3. Unlink fuel issues
      await tx.fuelIssue.updateMany({
        where: { bulkTankId },
        data: { bulkTankId: null },
      });

      // 4. Delete bulk tank
      await tx.bulkTank.delete({
        where: { id: bulkTankId },
      });
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "DELETE",
        entity: "BulkTank",
        entityId: bulkTankId,
        summary: `Deleted storage pump "${tank.name}" (${tank.fuelKind})`,
      },
    });

    revalidatePath("/admin/projects");
    revalidatePath("/workshop");
    return { success: true };
  } catch (err: any) {
    console.error("Delete bulk tank error:", err);
    return { error: err.message || "Failed to delete storage pump" };
  }
}

