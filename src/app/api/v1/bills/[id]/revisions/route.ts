import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { prisma } from "@/lib/db";
import { canReadBillFor } from "@/lib/roles";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const { id } = await props.params;

  const bill = await prisma.bill.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  });
  if (!bill) {
    return err("NOT_FOUND", `Bill '${id}' not found`, 404);
  }
  if (auth.user && !canReadBillFor(auth.user, bill.projectId)) {
    return err("FORBIDDEN", "You do not have access to view this bill", 403);
  }

  const revisions = await prisma.billRevision.findMany({
    where: { billId: id },
    orderBy: { revision: "desc" },
  });

  return ok(revisions);
}
