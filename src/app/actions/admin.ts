"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// 1. Update Settings
export async function updateSettingsAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const scraperEnabled = formData.get("scraperEnabled") === "true" ? "true" : "false";
  const scraperCron = formData.get("scraperCron")?.toString() || "0 0 1 * *";
  const backupCron = formData.get("backupCron")?.toString() || "30 2 * * *";
  const backupRetentionDays = formData.get("backupRetentionDays")?.toString() || "7";

  try {
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: "scraper.enabled" },
        update: { value: scraperEnabled },
        create: { key: "scraper.enabled", value: scraperEnabled },
      }),
      prisma.setting.upsert({
        where: { key: "scraper.cron" },
        update: { value: scraperCron },
        create: { key: "scraper.cron", value: scraperCron },
      }),
      prisma.setting.upsert({
        where: { key: "backup.cron" },
        update: { value: backupCron },
        create: { key: "backup.cron", value: backupCron },
      }),
      prisma.setting.upsert({
        where: { key: "backup.retentionDays" },
        update: { value: backupRetentionDays },
        create: { key: "backup.retentionDays", value: backupRetentionDays },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Setting",
        summary: `Updated system settings: scraper.enabled=${scraperEnabled}, backup.retentionDays=${backupRetentionDays}`,
      },
    });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (err: any) {
    console.error("Update settings error:", err);
    return { error: err.message || "Failed to update settings" };
  }
}

// 2. Create User (Admin only)
export async function createUserAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const username = formData.get("username")?.toString().trim().toLowerCase();
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim() || null;
  const password = formData.get("password")?.toString();
  const role = formData.get("role")?.toString(); // "ADMIN" | "USER" | "ALLOCATOR" | "WORKSHOP"
  const projectId = formData.get("projectId")?.toString() || null;
  const bulkTankId = formData.get("bulkTankId")?.toString() || null;

  if (!username || !name || !password || !role) {
    return { error: "All fields are required" };
  }

  if (role !== "ADMIN" && role !== "USER" && role !== "ALLOCATOR" && role !== "WORKSHOP") {
    return { error: "Invalid user role specified" };
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      return { error: `Username "${username}" is already in use` };
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const newUser = await prisma.user.create({
      data: {
        username,
        name,
        email,
        passwordHash,
        role,
        projectId: role === "USER" && projectId ? projectId : null,
        bulkTankId: role === "WORKSHOP" && bulkTankId ? bulkTankId : null,
        active: true,
        createdById: admin.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "User",
        entityId: newUser.id,
        summary: `Created new user "${username}" with role ${role}`,
      },
    });

    revalidatePath("/admin/users");
    return { success: true };
  } catch (err: any) {
    console.error("Create user error:", err);
    return { error: err.message || "Failed to create user account" };
  }
}

// 3. Toggle User Active Status
export async function toggleUserStatusAction(targetUserId: string, active: boolean) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  if (targetUserId === admin.id) {
    return { error: "You cannot deactivate your own administrator account" };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      return { error: "User account not found" };
    }

    await prisma.user.update({
      where: { id: targetUserId },
      data: { active },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "User",
        entityId: targetUserId,
        summary: `${active ? "Activated" : "Deactivated"} account for "${user.username}"`,
      },
    });

    revalidatePath("/admin/users");
    return { success: true };
  } catch (err: any) {
    console.error("Toggle user status error:", err);
    return { error: err.message || "Failed to update user status" };
  }
}

// 4. Run On-Demand Database Backup
export async function runOnDemandBackupAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const dbPath = path.join(process.cwd(), "data", "app.db");
  const backupDir = path.join(process.cwd(), "backups");

  if (!fs.existsSync(dbPath)) {
    return { error: "Database file 'data/app.db' does not exist" };
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const formatDigit = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}${formatDigit(now.getMonth() + 1)}${formatDigit(now.getDate())}-${formatDigit(now.getHours())}${formatDigit(now.getMinutes())}${formatDigit(now.getSeconds())}`;
  const backupFilename = `app-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  let sourceDb;
  try {
    sourceDb = new Database(dbPath, { readonly: true });
    const escapedBackupPath = backupPath.replace(/\\/g, "/");
    sourceDb.exec(`VACUUM INTO '${escapedBackupPath}'`);
    sourceDb.close();

    // Fetch retention setting
    const tempDb = new Database(dbPath, { readonly: true });
    const settingRow = tempDb.prepare("SELECT value FROM Setting WHERE key = 'backup.retentionDays'").get() as { value: string } | undefined;
    const retentionDays = settingRow ? parseInt(settingRow.value, 10) : 7;
    tempDb.close();

    // Rotate backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("app-") && f.endsWith(".db"))
      .map(f => {
        const fullPath = path.join(backupDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    files.forEach((file, index) => {
      if (file.mtime < cutoffTime && index >= 3) {
        fs.unlinkSync(file.path);
        deletedCount++;
      }
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "BACKUP",
        entity: "Database",
        summary: `Manually triggered backup successful: ${backupFilename}. Rotated ${deletedCount} files.`,
      },
    });

    revalidatePath("/admin/backups");
    return { success: true, filename: backupFilename };
  } catch (err: any) {
    console.error("Manual backup error:", err);
    return { error: err.message || "Failed to complete database backup" };
  }
}

// 5. Add Manual Override Price
export async function addManualPriceAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const fuelKind = formData.get("fuelKind")?.toString();
  const priceLkrStr = formData.get("priceLkr")?.toString();
  const dateStr = formData.get("effectiveFrom")?.toString();
  const note = formData.get("note")?.toString().trim() || null;

  if (!fuelKind || !priceLkrStr || !dateStr) {
    return { error: "Please fill in all required fields" };
  }

  const priceLkr = parseFloat(priceLkrStr);
  const effectiveFrom = new Date(dateStr);

  if (isNaN(priceLkr) || priceLkr <= 0) {
    return { error: "Price must be a positive number in LKR" };
  }

  // Convert LKR to cents
  const pricePerLitre = Math.round(priceLkr * 100);

  try {
    const entry = await prisma.fuelPrice.upsert({
      where: {
        fuelKind_effectiveFrom: {
          fuelKind,
          effectiveFrom,
        },
      },
      update: {
        pricePerLitre,
        source: "MANUAL",
        enteredById: admin.id,
        note,
      },
      create: {
        fuelKind,
        pricePerLitre,
        effectiveFrom,
        source: "MANUAL",
        enteredById: admin.id,
        note,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        entityId: entry.id,
        summary: `Set manual price for ${fuelKind} = Rs. ${priceLkr} effective from ${effectiveFrom.toISOString().split("T")[0]}`,
      },
    });

    revalidatePath("/admin/prices");
    revalidatePath("/fuel/issues");
    return { success: true };
  } catch (err: any) {
    console.error("Add manual price error:", err);
    return { error: err.message || "Failed to register manual price entry" };
  }
}

// 6. Update User Assignment (Admin only)
export async function updateUserAssignmentAction(targetUserId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString(); // "ADMIN" | "USER" | "ALLOCATOR" | "WORKSHOP"
  const projectId = formData.get("projectId")?.toString() || null;
  const bulkTankId = formData.get("bulkTankId")?.toString() || null;

  if (!name || !role) {
    return { error: "Name and Role are required fields" };
  }

  if (role !== "ADMIN" && role !== "USER" && role !== "ALLOCATOR" && role !== "WORKSHOP") {
    return { error: "Invalid user role specified" };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      return { error: "User account not found" };
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        name,
        role,
        projectId: role === "USER" && projectId ? projectId : null,
        bulkTankId: role === "WORKSHOP" && bulkTankId ? bulkTankId : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "User",
        entityId: targetUserId,
        summary: `Updated user "${user.username}" settings: Name="${name}", Role="${role}", ProjectId="${updatedUser.projectId || "none"}", BulkTankId="${updatedUser.bulkTankId || "none"}"`,
      },
    });

    revalidatePath("/admin/users");
    return { success: true };
  } catch (err: any) {
    console.error("Update user assignment error:", err);
    return { error: err.message || "Failed to update user assignment" };
  }
}

