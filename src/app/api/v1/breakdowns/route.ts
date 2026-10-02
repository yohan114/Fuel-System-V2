import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { getBreakdownEpisodes } from "@/lib/breakdowns";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || currentMonthPeriod().periodKey;
  const projectId = url.searchParams.get("projectId") || undefined;

  const [y, m] = ym.split("-").map(Number);
  const period = resolvePeriod(y, m);

  const log = await getBreakdownEpisodes({
    from: period.start,
    to: period.end,
    projectId,
  });

  return ok({
    periodKey: ym,
    stats: log.stats,
    openNow: log.openNow,
    episodes: log.episodes,
  });
}
