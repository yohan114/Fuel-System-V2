import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { prisma } from "@/lib/db";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const revisions = await prisma.billRevision.findMany({
    where: { billId: id },
    orderBy: { revision: "desc" },
  });

  return ok(revisions);
}
