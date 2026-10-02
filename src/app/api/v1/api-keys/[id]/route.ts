import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can revoke API keys", 403);
  }

  const { id } = await props.params;

  const key = await prisma.apiKey.findUnique({
    where: { id },
  });

  if (!key) {
    return err("NOT_FOUND", "API key not found", 404);
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: {
      active: false,
      revokedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      active: true,
      revokedAt: true,
    },
  });

  return ok({
    message: "API key revoked successfully",
    apiKey: updated,
  });
}
