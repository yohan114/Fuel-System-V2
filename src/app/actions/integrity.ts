"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

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
    return { success: true };
  } catch (err: any) {
    console.error("Record tank dip error:", err);
    return { error: err.message || "Failed to record tank dip" };
  }
}
