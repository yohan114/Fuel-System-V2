import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const categoryId = url.searchParams.get("categoryId") || undefined;
  const projectId = url.searchParams.get("projectId") || undefined;

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

  const report = await aggregateFuelData({
    from,
    to,
    categoryId,
    projectId,
  });

  return ok(report);
}
