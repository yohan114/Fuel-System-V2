"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

// Records a physical bulk-tank dip and snapshots the system balance so the
// variance (shrinkage/overage) is captured at the moment of measurement.
export async function recordTankDipAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to perform this action" };
  }

  const bulkTankId = formData.get("bulkTankId")?.toString();
  const dipLitresStr = formData.get("dipLitres")?.toString();
  const note = formData.get("note")?.toString() || null;

  if (!bulkTankId || !dipLitresStr) {
    return { error: "Tank and measured litres are required." };
  }
  const dipLitres = parseFloat(dipLitresStr);
  if (isNaN(dipLitres) || dipLitres < 0) {
    return { error: "Measured litres must be zero or greater." };
  }

  try {
    const tank = await prisma.bulkTank.findUnique({ where: { id: bulkTankId } });
    if (!tank) return { error: "Tank not found." };

    const computedBalance = tank.balance;
    const variance = dipLitres - computedBalance;

    const dip = await prisma.tankDip.create({
      data: {
        bulkTankId,
        dipLitres,
        computedBalance,
        variance,
        dipDate: new Date(),
        note,
        recordedById: admin.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "TankDip",
        entityId: dip.id,
        summary: `Tank dip for "${tank.name}": measured ${dipLitres.toFixed(1)}L vs system ${computedBalance.toFixed(1)}L (variance ${variance >= 0 ? "+" : ""}${variance.toFixed(1)}L)`,
      },
    });

    revalidatePath("/admin/tanks");
    revalidatePath("/fuel/bulk");
    return { success: true };
  } catch (err: unknown) {
    console.error("Record tank dip error:", err);
    return { error: errorMessage(err) || "Failed to record tank dip" };
  }
}

// Request bulk fuel (from outside delivery or site-to-site transfer)
export async function createBulkRequestAction(formData: FormData) {
  let user;
  try {
    user = await assertCan("create");
  } catch {
    return { error: "You are not authorized to create bulk fuel requests" };
  }

  const bulkTankId = formData.get("bulkTankId")?.toString();
  const fuelKind = formData.get("fuelKind")?.toString() || "AUTO_DIESEL";
  const requestedLitresStr = formData.get("requestedLitres")?.toString();
  const sourceType = formData.get("sourceType")?.toString() || "OUTSIDE";
  const sourceTankId = formData.get("sourceTankId")?.toString() || null;

  if (!bulkTankId || !requestedLitresStr) {
    return { error: "Target tank and litres are required" };
  }

  const requestedLitres = parseFloat(requestedLitresStr);
  if (isNaN(requestedLitres) || requestedLitres <= 0) {
    return { error: "Requested litres must be greater than zero" };
  }

  if (sourceType === "SITE" && !sourceTankId) {
    return { error: "Source tank is required for site-to-site transfer" };
  }

  if (sourceType === "SITE" && sourceTankId === bulkTankId) {
    return { error: "Source tank and target tank cannot be the same" };
  }

  try {
    const targetTank = await prisma.bulkTank.findUnique({ where: { id: bulkTankId } });
    if (!targetTank) return { error: "Target tank not found" };

    if (sourceType === "SITE" && sourceTankId) {
      const sourceTank = await prisma.bulkTank.findUnique({ where: { id: sourceTankId } });
      if (!sourceTank) return { error: "Source tank not found" };
      if (sourceTank.balance < requestedLitres) {
        return { error: `Source tank "${sourceTank.name}" has only ${sourceTank.balance.toFixed(1)} L available` };
      }
    }

    const req = await prisma.bulkRequest.create({
      data: {
        bulkTankId,
        fuelKind,
        requestedLitres,
        sourceType,
        sourceTankId: sourceType === "SITE" ? sourceTankId : null,
        status: "PENDING",
        requestedById: user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entity: "BulkRequest",
        entityId: req.id,
        summary: `Requested ${requestedLitres} L ${fuelKind} for ${targetTank.name} (${sourceType === "SITE" ? "Transfer" : "Delivery"})`,
      },
    });

    revalidatePath("/fuel/bulk");
    revalidatePath("/admin/tanks");
    return { success: true, id: req.id };
  } catch (err: unknown) {
    console.error("Create bulk request error:", err);
    return { error: errorMessage(err) || "Failed to create bulk fuel request" };
  }
}

// Approve a bulk request: increments target tank (and decrements source tank if transfer)
export async function approveBulkRequestAction(requestId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to approve bulk fuel requests" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.bulkRequest.findUnique({
        where: { id: requestId },
        include: { bulkTank: true, sourceTank: true },
      });

      if (!req) throw new Error("Bulk request not found");
      if (req.status !== "PENDING") throw new Error("Request already processed");

      if (req.sourceType === "SITE" && req.sourceTankId) {
        if (!req.sourceTank || req.sourceTank.balance < req.requestedLitres) {
          throw new Error(`Insufficient fuel in source tank (${req.sourceTank?.balance ?? 0} L available)`);
        }
        await tx.bulkTank.update({
          where: { id: req.sourceTankId },
          data: { balance: { decrement: req.requestedLitres } },
        });
      }

      await tx.bulkTank.update({
        where: { id: req.bulkTankId },
        data: { balance: { increment: req.requestedLitres } },
      });

      await tx.bulkRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          reviewedById: admin.id,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "APPROVE",
          entity: "BulkRequest",
          entityId: req.id,
          summary: `Approved bulk transfer of ${req.requestedLitres} L into ${req.bulkTank.name} (${req.sourceType})`,
        },
      });
    });

    revalidatePath("/fuel/bulk");
    revalidatePath("/admin/tanks");
    return { success: true };
  } catch (err: unknown) {
    console.error("Approve bulk request error:", err);
    return { error: errorMessage(err) || "Failed to approve bulk request" };
  }
}

// Reject a bulk request
export async function rejectBulkRequestAction(requestId: string, note?: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to reject bulk fuel requests" };
  }

  try {
    await prisma.bulkRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewedById: admin.id,
        reviewedAt: new Date(),
        reviewNote: note || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "REJECT",
        entity: "BulkRequest",
        entityId: requestId,
        summary: `Rejected bulk request: ${note || "No note"}`,
      },
    });

    revalidatePath("/fuel/bulk");
    revalidatePath("/admin/tanks");
    return { success: true };
  } catch (err: unknown) {
    console.error("Reject bulk request error:", err);
    return { error: errorMessage(err) || "Failed to reject bulk request" };
  }
}

