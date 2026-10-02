import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { isSiteUser, isPumpOperator } from "@/lib/roles";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  password: z.string().min(6).optional(),
  role: z.enum(["ADMIN", "USER", "ALLOCATOR", "WORKSHOP", "SITE_PUMP"]).optional(),
  active: z.boolean().optional(),
  projectId: z.string().optional().nullable(),
  bulkTankId: z.string().optional().nullable(),
});

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can view user details", 403);
  }

  const { id } = await props.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      projectId: true,
      project: { select: { id: true, name: true, code: true } },
      bulkTankId: true,
      bulkTank: { select: { id: true, name: true } },
    },
  });

  if (!user) {
    return err("NOT_FOUND", `User '${id}' not found`, 404);
  }

  return ok(user);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can modify users", 403);
  }

  const { id } = await props.params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return err("NOT_FOUND", `User '${id}' not found`, 404);
  }

  try {
    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid update payload", 400, parsed.error.format());
    }

    const { name, email, password, role, active, projectId, bulkTankId } = parsed.data;

    if (email && email.trim().toLowerCase() !== existing.email?.toLowerCase()) {
      const emailExisting = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (emailExisting) {
        return err("CONFLICT", `Email '${email}' is already registered`, 409);
      }
    }

    const targetRole = role ?? existing.role;

    const data: Record<string, any> = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email ? email.trim().toLowerCase() : null;
    if (password !== undefined) data.passwordHash = bcrypt.hashSync(password, 10);
    if (role !== undefined) data.role = role;
    if (active !== undefined) data.active = active;
    if (projectId !== undefined) {
      data.projectId = isSiteUser(targetRole) ? (projectId || null) : null;
    }
    if (bulkTankId !== undefined) {
      data.bulkTankId = isPumpOperator(targetRole) ? (bulkTankId || null) : null;
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        projectId: true,
        bulkTankId: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.user?.id ?? null,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        summary: `Updated user ${updated.username} via API`,
      },
    });

    return ok(updated);
  } catch (error) {
    console.error(`[api/v1/users/${id} PATCH] Error:`, error);
    return err("INTERNAL_ERROR", "Failed to update user", 500);
  }
}
