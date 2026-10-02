import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  contactName: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          assets: true,
          bulkTanks: true,
        },
      },
    },
  });

  return ok(projects);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can create project sites", 403);
  }

  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid project parameters", 400, parsed.error.format());
    }

    const { name, code, contactName, contactEmail } = parsed.data;
    const existing = await prisma.project.findUnique({ where: { code } });
    if (existing) {
      return err("CONFLICT", `Project with code '${code}' already exists`, 409);
    }

    const project = await prisma.project.create({
      data: {
        name,
        code,
        contactName: contactName ?? null,
        contactEmail: contactEmail ?? null,
      },
    });

    return ok(project, undefined, 201);
  } catch (error) {
    console.error("[api/v1/projects POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create project", 500);
  }
}
