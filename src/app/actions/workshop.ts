"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { isPumpOperator, isSiteUser } from "@/lib/roles";
import { canUserAccessAsset } from "@/lib/assignments";
import { resolveAsset, ambiguousAssetError } from "@/lib/fleet/resolve-asset";
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

// 2. Record a Bulk Replenishment (pump operator / admin)
//
// Replenishment is applied immediately — there is no admin approval step. The
// authorisation that used to happen at approval time therefore has to happen
// here instead: only a pump operator or an admin may top a tank up, and an
// operator may only top up the tank they are linked to. Without these guards
// any account holding "create" (which includes plain USER) could silently add
// litres to any tank in the company.
//
// The compensating control for the removed approval is the audit trail plus the
// physical dip at /admin/tanks: book stock that has been inflated without fuel
// arriving shows up there as a shortfall.
export async function submitBulkRequestAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && !isPumpOperator(user.role)) {
    return { error: "Only pump operators can record a fuel replenishment." };
  }

  // Fuel operations are allowed 24/7 — the 08:00–17:00 time window was removed.

  const bulkTankId = formData.get("bulkTankId")?.toString();
  const requestedLitresStr = formData.get("requestedLitres")?.toString();
  const sourceType = formData.get("sourceType")?.toString() === "SITE" ? "SITE" : "OUTSIDE";
  const sourceTankId = formData.get("sourceTankId")?.toString() || null;

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

    if (!isAdmin && tank.id !== user.bulkTankId) {
      return { error: "You can only record a replenishment for your own pump." };
    }

    // When fuel is drawn from another site, validate the source tank up front so
    // the operator gets a clear message; it is re-checked inside the
    // transaction below, since the balance can move in between.
    let sourceTank = null;
    if (sourceType === "SITE") {
      if (!sourceTankId) return { error: "Choose the site to draw fuel from." };
      if (sourceTankId === bulkTankId) return { error: "Source and destination tanks must be different." };
      sourceTank = await prisma.bulkTank.findUnique({ where: { id: sourceTankId } });
      if (!sourceTank) return { error: "Source site tank not found." };
      if (sourceTank.fuelKind !== tank.fuelKind) return { error: "That site holds a different fuel type." };
      if (sourceTank.balance < requestedLitres) {
        // Never quote the remaining litres to a non-admin: repeated trial
        // requests would let an operator binary-search another site's level.
        return {
          error: isAdmin
            ? `${sourceTank.name} only has ${sourceTank.balance.toFixed(1)}L available.`
            : `${sourceTank.name} does not have ${requestedLitres}L available. Try a smaller quantity or another site.`,
        };
      }
    }

    const sourceLabel = sourceType === "SITE" ? `from site "${sourceTank!.name}"` : "by outside purchase";
    const now = new Date();

    // Applied in one transaction: the stock movement and the log entry either
    // both land or neither does.
    await prisma.$transaction(async (tx) => {
      if (sourceType === "SITE" && sourceTankId) {
        const source = await tx.bulkTank.findUnique({ where: { id: sourceTankId } });
        if (!source) throw new Error("The source site tank no longer exists.");
        if (source.balance < requestedLitres) {
          throw new Error(`${source.name} no longer has ${requestedLitres}L available.`);
        }
        await tx.bulkTank.update({
          where: { id: source.id },
          data: { balance: { decrement: requestedLitres } },
        });
      }

      const updated = await tx.bulkTank.update({
        where: { id: tank.id },
        data: { balance: { increment: requestedLitres } },
      });

      const req = await tx.bulkRequest.create({
        data: {
          bulkTankId: tank.id,
          fuelKind: tank.fuelKind,
          requestedLitres,
          requestedById: user.id,
          status: "APPROVED",
          reviewedById: user.id,
          reviewedAt: now,
          reviewNote: "Auto-applied — replenishment approval is not required.",
          sourceType,
          sourceTankId: sourceType === "SITE" ? sourceTankId : null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "REPLENISH",
          entity: "BulkRequest",
          entityId: req.id,
          summary: `${user.name} added ${requestedLitres}L of ${tank.fuelKind} to "${tank.name}" ${sourceLabel} (applied immediately)`,
          metaJson: JSON.stringify({
            tank: tank.name,
            litres: requestedLitres,
            sourceType,
            sourceTank: sourceTank?.name ?? null,
            balanceAfter: updated.balance,
          }),
        },
      });
    });

    revalidatePath("/workshop");
    revalidatePath("/site");
    revalidatePath("/admin/tanks");
    revalidatePath("/admin/projects");
    return { success: true };
  } catch (err: any) {
    console.error("Record replenishment error:", err);
    return { error: err.message || "Failed to record replenishment" };
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
      include: { bulkTank: true, sourceTank: true },
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

      if (req.sourceType === "SITE" && req.sourceTankId) {
        // Inter-site transfer: draw the fuel from the chosen source site tank
        // and add it to the target tank. Re-check the balance at approval time.
        const source = req.sourceTank ?? (await tx.bulkTank.findUnique({ where: { id: req.sourceTankId } }));
        if (!source) {
          throw new Error("The source site tank no longer exists.");
        }
        if (source.balance < req.requestedLitres) {
          throw new Error(`Insufficient fuel at source "${source.name}". Available: ${source.balance.toFixed(1)}L, requested: ${req.requestedLitres}L.`);
        }
        await tx.bulkTank.update({
          where: { id: source.id },
          data: { balance: { decrement: req.requestedLitres } },
        });
        await tx.bulkTank.update({
          where: { id: req.bulkTankId },
          data: { balance: { increment: req.requestedLitres } },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: requestId,
            summary: `Approved fuel transfer of ${req.requestedLitres}L from site "${source.name}" to "${req.bulkTank.name}"`,
          },
        });
      } else {
        // Outside purchase: a supplier delivery straight into the target tank.
        await tx.bulkTank.update({
          where: { id: req.bulkTankId },
          data: { balance: { increment: req.requestedLitres } },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "APPROVE",
            entity: "BulkRequest",
            entityId: requestId,
            summary: `Approved outside-purchase delivery of ${req.requestedLitres}L to "${req.bulkTank.name}"`,
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

  if (!isPumpOperator(user.role) || !user.bulkTankId) {
    return { error: "Only accounts with a linked pump (workshop or site) can issue fuel from bulk." };
  }

  const assetId = formData.get("assetId")?.toString();
  const litresStr = formData.get("litres")?.toString();
  const meterReadingStr = formData.get("meterReading")?.toString();
  const reason = formData.get("reason")?.toString() || null;
  const projectId = formData.get("projectId")?.toString() || null;
  const issueDateStr = formData.get("issueDate")?.toString() || null;

  // Fuel issuing is allowed 24/7 — the after-hours reason gate was removed; any
  // reason may be used at any time. Date/time, user, site, vehicle and person
  // are still recorded for audit.

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
    // Fuel may be issued for any past date (the 14-day backdate cap was removed).

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
      // Never quote the remaining litres back: repeated trial issues would let
      // an operator binary-search the exact tank level in a dozen attempts,
      // defeating the point of hiding it in the console.
      return {
        error: `${tank.name} does not have enough fuel to issue ${litres}L. Record a bulk replenishment, or contact an administrator.`,
      };
    }

    // 2. Fetch or create asset (supporting typing on-the-fly). Matching is
    // punctuation-insensitive so "ZA0050" finds the vehicle registered
    // "ZA-0050" instead of creating a duplicate for it.
    const match = await resolveAsset(assetId);
    if (match.kind === "ambiguous") {
      return { error: ambiguousAssetError(assetId, match.codes) };
    }
    let asset = match.kind === "found" ? match.asset : null;

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

    // A site pump operator may only fuel vehicles allocated to their own site
    // (the Badalgama workshop pump is intentionally unscoped and may fuel any
    // vehicle on any site).
    //
    // Fails closed on an unconfigured account: visibleAssetIdsForUser treats a
    // site user with no projectId as "unrestricted", so without this check a
    // site pump operator who has not been assigned a site could fuel any
    // vehicle in the company — the exact opposite of the intended rule.
    if (isSiteUser(user.role)) {
      if (!user.projectId) {
        return {
          error:
            "Your account is not linked to a site, so fuel cannot be issued from it. Ask an administrator to set your site in User Accounts.",
        };
      }
      const allowed = await canUserAccessAsset(user, asset.id, issueDate);
      if (!allowed) {
        return { error: "This vehicle is not allocated to your site." };
      }
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
          issuePerson: user.name,
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

      // D. Log audit. Filed under a dedicated ISSUE action (rather than the
      // generic CREATE) so an admin can pull every dispatch — and, with
      // REPLENISH, every stock movement — straight out of /admin/audit.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "ISSUE",
          entity: "FuelIssue",
          entityId: issue.id,
          summary: `${user.name} issued ${litres}L of ${tank.fuelKind} to ${asset.code} from "${tank.name}"${meterReading !== null ? ` at ${meterReading} ${asset.meterType}` : " (no meter reading)"}`,
          metaJson: JSON.stringify({
            tank: tank.name,
            asset: asset.code,
            litres,
            meterReading,
            issueDate: issueDate.toISOString(),
          }),
        },
      });
    });

    revalidatePath("/workshop");
    revalidatePath("/site");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/fuel/issues");
    revalidatePath("/admin/tanks");
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

