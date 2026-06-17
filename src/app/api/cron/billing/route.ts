import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBillingConfig } from "@/lib/billing/config";
import { previousMonthPeriod, resolvePeriod } from "@/lib/billing/period";
import { generateBillsForMonth, sweepOverdueBills } from "@/lib/billing/generate";

// Monthly bill generation, triggered by an external scheduler per the
// `billing.cron` setting. Authorized with CRON_SECRET (header `x-cron-secret`
// or `?secret=`). `src/proxy.ts` already lets /api/cron/* bypass the session
// redirect. Pass ?year=&month= to replay a specific month.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const provided =
    request.headers.get("x-cron-secret") || request.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = await getBillingConfig();
  if (!cfg.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "billing.enabled is false" });
  }

  const { searchParams } = request.nextUrl;
  const yearStr = searchParams.get("year");
  const monthStr = searchParams.get("month");
  const period =
    yearStr && monthStr
      ? resolvePeriod(parseInt(yearStr, 10), parseInt(monthStr, 10))
      : previousMonthPeriod();

  try {
    const result = await generateBillsForMonth({
      year: period.year,
      month: period.month,
      regenerate: false,
      actorId: null,
    });
    const overdue = await sweepOverdueBills();

    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Bill",
        summary: `Cron generated ${result.created} bills for ${result.periodKey} (skipped ${result.skippedExisting + result.skippedFinalized}, noRate ${result.noRate}); ${overdue} marked overdue`,
      },
    });

    return NextResponse.json({ ok: true, period: period.periodKey, result, overdue });
  } catch (err: any) {
    console.error("Cron billing error:", err);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
