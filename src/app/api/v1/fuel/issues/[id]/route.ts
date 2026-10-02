import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const [issue, auditLogs] = await Promise.all([
    prisma.fuelIssue.findUnique({
      where: { id },
      omit: { photoData: true },
      include: {
        asset: {
          include: {
            category: true,
            project: true,
          },
        },
        issuedBy: {
          select: { id: true, name: true, username: true, role: true },
        },
        bulkTank: true,
        meterReadingRecord: true,
        corrections: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: { entity: "FuelIssue", entityId: id },
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  if (!issue) {
    return err("NOT_FOUND", `Fuel issue '${id}' not found`, 404);
  }

  return ok({
    ...issue,
    hasPhoto: !!issue.photoName,
    auditTrail: auditLogs,
  });
}
