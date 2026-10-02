import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { z } from "zod";

const setBudgetSchema = z.object({
  projectId: z.string().min(1),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  budgetLitres: z.number().nonnegative().optional().nullable(),
  budgetAmountCents: z.number().int().nonnegative().optional().nullable(),
  note: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const ym = url.searchParams.get("ym");
  const projectId = url.searchParams.get("projectId") || undefined;

  let year: number | undefined;
  let month: number | undefined;
  if (ym && ym.includes("-")) {
    const parts = ym.split("-").map(Number);
    year = parts[0];
    month = parts[1];
  }

  const budgets = await prisma.budget.findMany({
    where: {
      ...(year ? { year } : {}),
      ...(month ? { month } : {}),
      ...(projectId ? { projectId } : {}),
    },
    include: {
      project: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return ok(budgets);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can configure fuel budgets", 403);
  }

  try {
    const body = await req.json();
    const parsed = setBudgetSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid budget data", 400, parsed.error.format());
    }

    const { projectId, year, month, budgetLitres, budgetAmountCents, note } = parsed.data;

    const budget = await prisma.budget.upsert({
      where: {
        projectId_year_month: {
          projectId,
          year,
          month,
        },
      },
      update: {
        budgetLitres: budgetLitres ?? null,
        budgetAmountCents: budgetAmountCents ?? null,
        note: note ?? null,
        createdById: auth.user?.id ?? null,
      },
      create: {
        projectId,
        year,
        month,
        budgetLitres: budgetLitres ?? null,
        budgetAmountCents: budgetAmountCents ?? null,
        note: note ?? null,
        createdById: auth.user?.id ?? null,
      },
      include: {
        project: true,
      },
    });

    return ok(budget, undefined, 201);
  } catch (error) {
    console.error("[api/v1/budgets POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to set budget", 500);
  }
}
