import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { getFleetConsumptionHealth } from "@/lib/analytics/consumption";
import { currentMonthPeriod } from "@/lib/billing/period";
import { isSiteUser } from "@/lib/roles";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  let projectId = url.searchParams.get("projectId") || undefined;

  // Site role scoping
  if (auth.user && isSiteUser(auth.role) && auth.user.projectId) {
    projectId = auth.user.projectId;
  }

  let from: Date;
  let to: Date;

  if (fromStr && toStr) {
    from = new Date(fromStr);
    to = new Date(toStr);
  } else {
    const period = currentMonthPeriod();
    from = period.start;
    to = period.end;
  }

  const health = await getFleetConsumptionHealth({
    from,
    to,
    projectId,
  });

  return ok(health);
}
