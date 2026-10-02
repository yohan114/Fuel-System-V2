import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { getSiteOverview } from "@/lib/reports/siteOverview";
import { currentMonthPeriod } from "@/lib/billing/period";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || currentMonthPeriod().periodKey;
  const [yearStr, monthStr] = ym.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return err("VALIDATION_ERROR", "Invalid period format. Expected YYYY-MM", 400);
  }

  const overview = await getSiteOverview({ year, month });
  return ok(overview);
}
