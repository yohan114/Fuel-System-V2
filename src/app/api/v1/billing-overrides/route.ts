import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { currentMonthPeriod } from "@/lib/billing/period";
import { addVehicleToSiteBillingAction } from "@/app/actions/billing-overrides";
import { z } from "zod";

const createOverrideSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  reason: z.string().optional(),
  setFuelOnly: z.boolean().default(false),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || currentMonthPeriod().periodKey;
  const projectId = url.searchParams.get("projectId");
  const assetId = url.searchParams.get("assetId");

  const overrides = await prisma.billingSiteOverride.findMany({
    where: {
      periodKey: ym,
      ...(projectId ? { projectId } : {}),
      ...(assetId ? { assetId } : {}),
    },
    include: {
      project: { select: { id: true, name: true, code: true } },
      asset: { select: { id: true, code: true, regNo: true } },
      createdBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return ok(overrides);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can configure billing overrides", 403);
  }

  try {
    const body = await req.json();
    const parsed = createOverrideSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid override parameters", 400, parsed.error.format());
    }

    const { projectId, assetId, periodKey, reason, setFuelOnly } = parsed.data;

    const result = await addVehicleToSiteBillingAction({
      projectId,
      assetId,
      periodKey,
      reason,
      fuelOnly: setFuelOnly,
    });

    if ("error" in result && result.error) {
      return err("OVERRIDE_FAILED", result.error, 400);
    }

    return ok(result, undefined, 201);
  } catch (error) {
    console.error("[api/v1/billing-overrides POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create billing override", 500);
  }
}
