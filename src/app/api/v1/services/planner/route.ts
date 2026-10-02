import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { getFleetServiceStatus } from "@/lib/service/fleet";
import { isSiteUser } from "@/lib/roles";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const url = new URL(req.url);
  let projectId = url.searchParams.get("projectId") || undefined;

  // Site role scoping
  if (auth.user && isSiteUser(auth.role) && auth.user.projectId) {
    projectId = auth.user.projectId;
  }

  const statuses = await getFleetServiceStatus({ projectId });
  return ok(statuses);
}
