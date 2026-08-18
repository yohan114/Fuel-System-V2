"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { DEFAULT_TANK_CAPACITY } from "@/lib/fuel-kinds";
import { errorMessage } from "@/lib/errors";
import { findSimilarProject } from "@/lib/site-name";

// Picks a tank name that isn't already taken (tank names are unique). Prefers
// "<project> Tank", then disambiguates with the project code.
async function uniqueTankName(
  tx: Pick<Prisma.TransactionClient, "bulkTank">,
  name: string,
  code: string,
): Promise<string> {
  const candidates = [`${name} Tank`, `${name} Tank (${code})`, `${code} Tank`];
  for (const c of candidates) {
    if (!(await tx.bulkTank.findUnique({ where: { name: c } }))) return c;
  }
  return `${name} Tank ${Date.now()}`;
}

// 1. Create a Project (Admin only)
export async function createProjectAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const name = formData.get("name")?.toString().trim();
  const code = formData.get("code")?.toString().trim().toUpperCase();
  const contactName = formData.get("contactName")?.toString().trim() || null;
  const contactEmail = formData.get("contactEmail")?.toString().trim() || null;

  if (!name || !code) {
    return { error: "Project Name and Code are required" };
  }

  try {
    const existingCode = await prisma.project.findUnique({
      where: { code },
    });
    if (existingCode) {
      return { error: `Project Code "${code}" is already in use` };
    }

    const existingName = await prisma.project.findUnique({
      where: { name },
    });
    if (existingName) {
      return { error: `Project Name "${name}" is already in use` };
    }

    // A site registered twice under a different qualifier ("Badalgama Plant"
    // vs "Badalgama Workshop") also creates a second tank below, splitting the
    // fuel history from the balance. Warn instead of silently duplicating; the
    // admin can tick "allowSimilar" when it really is a separate site.
    if (formData.get("allowSimilar")?.toString() !== "true") {
      const similar = findSimilarProject(
        name,
        await prisma.project.findMany({ select: { id: true, name: true, code: true } }),
      );
      if (similar) {
        return {
          error:
            `"${similar.name}" (${similar.code}) already covers this site. ` +
            `Registering it again creates a second tank, which splits the fuel ` +
            `history from the balance. Add machines to "${similar.name}" instead, ` +
            `or tick "separate site" if this really is a different place.`,
          similarProject: { id: similar.id, name: similar.name, code: similar.code },
        };
      }
    }

    // Create the project together with its own default diesel tank, so every
    // site has somewhere to receive and issue fuel from day one. The tank's
    // capacity defaults to DEFAULT_TANK_CAPACITY and stays fully editable /
    // deletable afterwards.
    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { name, code, contactName, contactEmail },
      });
      const tankName = await uniqueTankName(tx, name, code);
      const tank = await tx.bulkTank.create({
        data: { name: tankName, fuelKind: "AUTO_DIESEL", capacity: DEFAULT_TANK_CAPACITY, balance: 0, projectId: p.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "CREATE",
          entity: "Project",
          entityId: p.id,
          summary: `Created new project "${name}" (${code}) with default tank "${tankName}" (${DEFAULT_TANK_CAPACITY} L)`,
        },
      });
      return p;
    });

    revalidatePath("/admin/projects");
    return { success: true, tankCreated: true, projectId: project.id };
  } catch (err: unknown) {
    console.error("Create project error:", err);
    return { error: errorMessage(err) || "Failed to create project" };
  }
}

// 2. Assign Asset to Project (Allocator or Admin)
export async function assignAssetToProjectAction(assetId: string, projectId: string | null) {
  let actor;
  try {
    actor = await assertCan("allocate");
  } catch (err) {
    return { error: "You are not authorized to allocate assets to projects" };
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return { error: "Asset not found" };
    }

    let projectName = "UNASSIGNED";
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project) {
        return { error: "Selected project not found" };
      }
      projectName = project.name;
    }

    await prisma.asset.update({
      where: { id: assetId },
      data: { projectId },
    });

    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "UPDATE",
        entity: "Asset",
        entityId: assetId,
        summary: `Assigned asset ${asset.code} to project ${projectName}`,
      },
    });

    revalidatePath("/allocator");
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/");
    return { success: true };
  } catch (err: unknown) {
    console.error("Assign asset to project error:", err);
    return { error: errorMessage(err) || "Failed to update asset project assignment" };
  }
}

// 3. Update Project (Admin only)
export async function updateProjectAction(projectId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  const name = formData.get("name")?.toString().trim();
  const code = formData.get("code")?.toString().trim().toUpperCase();
  const contactName = formData.get("contactName")?.toString().trim() || null;
  const contactEmail = formData.get("contactEmail")?.toString().trim() || null;

  if (!name || !code) {
    return { error: "Project Name and Code are required" };
  }

  try {
    const existingCode = await prisma.project.findFirst({
      where: {
        code,
        id: { not: projectId },
      },
    });
    if (existingCode) {
      return { error: `Project Code "${code}" is already in use` };
    }

    const existingName = await prisma.project.findFirst({
      where: {
        name,
        id: { not: projectId },
      },
    });
    if (existingName) {
      return { error: `Project Name "${name}" is already in use` };
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { name, code, contactName, contactEmail },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Project",
        entityId: projectId,
        summary: `Updated project details: Name="${name}" (${code})`,
      },
    });

    revalidatePath("/admin/projects");
    return { success: true };
  } catch (err: unknown) {
    console.error("Update project error:", err);
    return { error: errorMessage(err) || "Failed to update project" };
  }
}

// 4. Delete Project (Admin only)
export async function deleteProjectAction(projectId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to perform this action" };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return { error: "Project not found" };
    }

    // Asset assignments are the billing history — which machine sat on this
    // site in which month. They are ON DELETE RESTRICT, so deleting a project
    // that still has them fails deep in the transaction with an opaque foreign
    // key error. Refuse up front and say what has to move first.
    const assignments = await prisma.assetAssignment.count({ where: { projectId } });
    if (assignments > 0) {
      return {
        error:
          `"${project.name}" still has ${assignments} asset assignment(s) recording which ` +
          `machines were on this site. Deleting it would erase that billing history. ` +
          `Move those assignments to the correct site first, or keep this project.`,
        blockedBy: { assetAssignments: assignments },
      };
    }

    await prisma.$transaction(async (tx) => {
      // Unlink users
      await tx.user.updateMany({
        where: { projectId },
        data: { projectId: null },
      });

      // Unlink assets
      await tx.asset.updateMany({
        where: { projectId },
        data: { projectId: null },
      });

      // Unlink bulk tanks
      await tx.bulkTank.updateMany({
        where: { projectId },
        data: { projectId: null },
      });

      // Delete project
      await tx.project.delete({
        where: { id: projectId },
      });
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "DELETE",
        entity: "Project",
        entityId: projectId,
        summary: `Deleted project "${project.name}" (${project.code})`,
      },
    });

    revalidatePath("/admin/projects");
    return { success: true };
  } catch (err: unknown) {
    console.error("Delete project error:", err);
    return { error: errorMessage(err) || "Failed to delete project" };
  }
}

