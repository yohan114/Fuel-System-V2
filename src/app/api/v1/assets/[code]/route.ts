import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { updateAssetSchema } from "@/lib/api/schemas";

export async function GET(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { code } = await props.params;

  const asset = await prisma.asset.findUnique({
    where: { code: decodeURIComponent(code) },
    include: {
      category: true,
      project: true,
      rentalRate: true,
      serviceIntervalOverride: true,
    },
  });

  if (!asset) {
    return err("NOT_FOUND", `Asset with code '${code}' not found`, 404);
  }

  return ok(asset);
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "write:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN" && auth.role !== "ALLOCATOR") {
    return err("FORBIDDEN", "Only admins or allocators can modify assets", 403);
  }

  const { code } = await props.params;

  const existing = await prisma.asset.findUnique({
    where: { code: decodeURIComponent(code) },
  });

  if (!existing) {
    return err("NOT_FOUND", `Asset with code '${code}' not found`, 404);
  }

  try {
    const body = await req.json();
    const parsed = updateAssetSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid update data", 400, parsed.error.format());
    }

    const updated = await prisma.asset.update({
      where: { id: existing.id },
      data: parsed.data,
      include: {
        category: true,
        project: true,
        rentalRate: true,
      },
    });

    return ok(updated);
  } catch (error) {
    console.error(`[api/v1/assets/${code} PATCH] Error:`, error);
    return err("INTERNAL_ERROR", "Failed to update asset", 500);
  }
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ code: string }> }
) {
  const authResult = await requireApi(req, "write:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can dispose assets", 403);
  }

  const { code } = await props.params;
  const existing = await prisma.asset.findUnique({
    where: { code: decodeURIComponent(code) },
  });

  if (!existing) {
    return err("NOT_FOUND", `Asset with code '${code}' not found`, 404);
  }

  const disposed = await prisma.asset.update({
    where: { id: existing.id },
    data: { status: "DISPOSED" },
  });

  return ok({ message: "Asset marked as DISPOSED", asset: disposed });
}
