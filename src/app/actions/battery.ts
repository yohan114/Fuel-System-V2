"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { normalize } from "@/lib/stock/classify";
import { extractFileField } from "@/lib/upload";
import { revalidatePath } from "next/cache";

function revalidate() {
  revalidatePath("/store/batteries");
}

// Register a new battery (one per vehicle; vehicle no + serial no both unique).
// A photo is mandatory and stored inline as Bytes (rides DB backups).
export async function addBatteryAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to register batteries." }; }

  const vehicleNo = String(formData.get("vehicleNo") || "").trim();
  const serialNo = String(formData.get("serialNo") || "").trim();
  if (!vehicleNo || !serialNo) return { error: "Vehicle number and serial number are required." };

  const photo = await extractFileField(formData, "photo");
  if (!photo) return { error: "A battery photo is required." };

  const vehicleNoNorm = normalize(vehicleNo);
  const serialNoNorm = normalize(serialNo);

  try {
    const battery = await prisma.battery.create({
      data: {
        vehicleNo, vehicleNoNorm, serialNo, serialNoNorm,
        note: String(formData.get("note") || "").trim() || null,
        photoData: photo.data, photoMime: photo.mime,
        createdById: user.id,
      },
    });
    await prisma.batteryEvent.create({
      data: {
        batteryId: battery.id, action: "ADD",
        serialNo, serialNoNorm, vehicleNo,
        photoData: photo.data, photoMime: photo.mime,
        userId: user.id,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: user.id, action: "CREATE", entity: "Battery", entityId: battery.id, summary: `Registered battery ${serialNo} on ${vehicleNo}` },
    });
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "That vehicle or serial number already has a live battery." };
    }
    throw e;
  }
  revalidate();
  return { success: true };
}

// Move a battery to a different vehicle (append-only audit; vehicle stays unique).
export async function transferBatteryAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to transfer batteries." }; }

  const id = String(formData.get("id") || "");
  const newVehicleNo = String(formData.get("newVehicleNo") || "").trim();
  if (!newVehicleNo) return { error: "Enter the destination vehicle number." };

  const battery = await prisma.battery.findUnique({ where: { id } });
  if (!battery) return { error: "Battery not found." };

  const fromVehicleNo = battery.vehicleNo;
  const vehicleNoNorm = normalize(newVehicleNo);
  try {
    await prisma.battery.update({ where: { id }, data: { vehicleNo: newVehicleNo, vehicleNoNorm } });
    await prisma.batteryEvent.create({
      data: {
        batteryId: id, action: "TRANSFER",
        serialNo: battery.serialNo, serialNoNorm: battery.serialNoNorm,
        vehicleNo: newVehicleNo, fromVehicleNo,
        reason: String(formData.get("reason") || "").trim() || null,
        userId: user.id,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: user.id, action: "UPDATE", entity: "Battery", entityId: id, summary: `Transferred battery ${battery.serialNo}: ${fromVehicleNo} → ${newVehicleNo}` },
    });
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "That destination vehicle already has a live battery." };
    }
    throw e;
  }
  revalidate();
  return { success: true };
}

// Mark a battery dead. The active register row is removed, but a DECOMMISSION
// event keeps a permanent snapshot (serial / vehicle / photo) for audit.
export async function decommissionBatteryAction(formData: FormData) {
  let user;
  try { user = await assertCan("manage"); }
  catch { return { error: "You are not authorized to decommission batteries." }; }

  const id = String(formData.get("id") || "");
  const battery = await prisma.battery.findUnique({ where: { id } });
  if (!battery) return { error: "Battery not found." };

  await prisma.batteryEvent.create({
    data: {
      batteryId: id, action: "DECOMMISSION",
      serialNo: battery.serialNo, serialNoNorm: battery.serialNoNorm,
      vehicleNo: battery.vehicleNo,
      reason: String(formData.get("reason") || "").trim() || "Marked dead",
      photoData: battery.photoData, photoMime: battery.photoMime,
      userId: user.id,
    },
  });
  await prisma.battery.delete({ where: { id } });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "DELETE", entity: "Battery", entityId: id, summary: `Decommissioned battery ${battery.serialNo} (was on ${battery.vehicleNo})` },
  });
  revalidate();
  return { success: true };
}
