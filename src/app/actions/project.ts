"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

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

    const project = await prisma.project.create({
      data: { name, code, contactName, contactEmail },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "Project",
        entityId: project.id,
        summary: `Created new project "${name}" (${code})`,
      },
    });

    revalidatePath("/admin/projects");
    return { success: true };
  } catch (err: any) {
    console.error("Create project error:", err);
    return { error: err.message || "Failed to create project" };
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
  } catch (err: any) {
    console.error("Assign asset to project error:", err);
    return { error: err.message || "Failed to update asset project assignment" };
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
  } catch (err: any) {
    console.error("Update project error:", err);
    return { error: err.message || "Failed to update project" };
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
  } catch (err: any) {
    console.error("Delete project error:", err);
    return { error: err.message || "Failed to delete project" };
  }
}

