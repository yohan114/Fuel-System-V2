import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
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
    include: {
      asset: {
        include: {
          category: true,
          rentalRate: true,
        },
      },
      lineItems: true,
      revisions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!bill) {
    return err("NOT_FOUND", `Bill '${id}' not found`, 404);
  }

  // Verify site scope
  if (auth.user && !canReadBillFor(auth.user, bill.projectId)) {
    return err("FORBIDDEN", "You do not have access to view this bill", 403);
  }

  return ok(bill);
}
