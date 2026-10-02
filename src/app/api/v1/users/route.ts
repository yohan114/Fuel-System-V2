import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { isSiteUser, isPumpOperator } from "@/lib/roles";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const createUserSchema = z.object({
  username: z.string().min(2).max(50),
  name: z.string().min(1).max(100),
  email: z.string().email().optional().nullable(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "USER", "ALLOCATOR", "WORKSHOP", "SITE_PUMP"]),
  projectId: z.string().optional().nullable(),
  bulkTankId: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can list users", 403);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const role = url.searchParams.get("role") || "";
  const activeParam = url.searchParams.get("active");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { username: { contains: q } },
      { name: { contains: q } },
      { email: { contains: q } },
    ];
  }
  if (role) where.role = role;
  if (activeParam !== null && activeParam !== undefined) {
    where.active = activeParam !== "false" && activeParam !== "0";
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
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
    }),
  ]);

  return ok(users, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can create users", 403);
  }

  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid user payload", 400, parsed.error.format());
    }

    const { username, name, email, password, role, projectId, bulkTankId } = parsed.data;
    const cleanUsername = username.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { username: cleanUsername },
    });
    if (existing) {
      return err("CONFLICT", `Username '${cleanUsername}' already exists`, 409);
    }

    if (email) {
      const emailExisting = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (emailExisting) {
        return err("CONFLICT", `Email '${email}' is already registered`, 409);
      }
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        name,
        email: email ? email.trim().toLowerCase() : null,
        passwordHash,
        role,
        projectId: isSiteUser(role) && projectId ? projectId : null,
        bulkTankId: isPumpOperator(role) && bulkTankId ? bulkTankId : null,
        active: true,
        createdById: auth.user?.id ?? null,
      },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        projectId: true,
        bulkTankId: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.user?.id ?? null,
        action: "CREATE",
        entity: "User",
        entityId: user.id,
        summary: `Created user ${user.username} (${user.role}) via API`,
      },
    });

    return ok(user, undefined, 201);
  } catch (error) {
    console.error("[api/v1/users POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create user", 500);
  }
}
