import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Read-only month-scoped cost + income feed for the Master Portal's profit
// engine (M5). Costs = fuel issues (litres × price snapshot). Income = the
// monthly rental+fuel invoices this system already produces. Token-authed;
// idempotent sourceRef per row. All money in LKR cents. Never mutates.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-portal-token");
  const expected = process.env.FUEL_PORTAL_TOKEN || process.env.PORTAL_TOKEN;
  if (!expected || !token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = request.nextUrl.searchParams.get("month"); // "YYYY-MM"
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const start = new Date(year, monthIdx, 1);
  const end = new Date(year, monthIdx + 1, 1);

  const [issues, bills] = await Promise.all([
    prisma.fuelIssue.findMany({
      where: { voided: false, issueDate: { gte: start, lt: end } },
      select: {
        id: true,
        litres: true,
        totalCost: true,
        issueDate: true,
        asset: { select: { code: true, site: true, project: { select: { name: true } } } },
      },
    }),
    prisma.bill.findMany({
      where: { year, month: monthIdx + 1 },
      select: {
        id: true,
        assetCode: true,
        projectName: true,
        rentalAmountCents: true,
        fuelCostCents: true,
        ssclCents: true,
        vatCents: true,
        grandTotalCents: true,
        issuedDate: true,
        createdAt: true,
        status: true,
      },
    }),
  ]);

  return NextResponse.json({
    system: "fuel",
    month,
    costs: issues.map((i) => ({
      sourceRef: `fuel:${i.id}`,
      machineCode: i.asset?.code ?? null,
      siteRef: i.asset?.project?.name ?? i.asset?.site ?? null,
      category: "fuel",
      qty: i.litres,
      amountCents: i.totalCost,
      occurredAt: i.issueDate.toISOString(),
    })),
    // Income split by component so the portal can compute the fuel margin
    // (fuel billed − fuel cost) separately from rental. Idempotent per part.
    income: bills.flatMap((b) => {
      const occurredAt = (b.issuedDate ?? b.createdAt).toISOString();
      const parts: { cat: string; cents: number }[] = [
        { cat: "rental", cents: b.rentalAmountCents },
        { cat: "fuel", cents: b.fuelCostCents },
        { cat: "tax", cents: (b.ssclCents ?? 0) + (b.vatCents ?? 0) },
      ];
      return parts
        .filter((p) => p.cents > 0)
        .map((p) => ({
          sourceRef: `bill:${b.id}:${p.cat}`,
          machineCode: b.assetCode,
          siteRef: b.projectName ?? null,
          category: p.cat,
          amountCents: p.cents,
          occurredAt,
          status: b.status,
        }));
    }),
  });
}
