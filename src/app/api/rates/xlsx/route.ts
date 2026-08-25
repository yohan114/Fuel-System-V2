import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { billingScope } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { getRatesOverview } from "@/lib/consumption/rates-overview";
import { getPortableOverview } from "@/lib/consumption/portable-overview";
import { buildRatesWorkbook, ratesWorkbookFilename } from "@/lib/reports/rates-workbook";
import { errorMessageOr } from "@/lib/errors";
import * as XLSX from "xlsx";

// "Export to Excel" on the Fuel & Rental Rates screen.
//
// The button has linked here since the page shipped and the route was never
// written, so every click has returned Next's 404 page — rendered in the tab,
// since the link is a plain anchor.
//
// Scoped with billingScope rather than the isSiteUser ternary two sibling
// export routes use. That ternary yields `undefined` for a site user whose site
// was never set, and `undefined` means "no filter" — the whole company. It is a
// fail-open shape, and this workbook is the company's entire commercial price
// list for the whole fleet: once downloaded it carries none of the app's access
// control with it. ADMIN and ALLOCATOR only; everyone else is refused outright
// rather than handed a reduced file, because two workbooks with the same name
// and different contents cannot be told apart once one has been emailed on.
export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (billingScope(session).kind !== "all") {
    return new NextResponse("Forbidden — the rate card export is for administrators and allocators.", { status: 403 });
  }

  try {
    const [overview, portable, basisRows] = await Promise.all([
      getRatesOverview(),
      getPortableOverview(),
      // The only thing fetched here rather than taken from the overview:
      // RateBandRow.basis is the RESOLVED basis, and resolveBand infers a
      // missing one from the figure's magnitude. Without the stored value the
      // sheet cannot tell a stated unit from a guessed one.
      prisma.rentalRate.findMany({ select: { assetId: true, fuelConsBasis: true } }),
    ]);

    const generatedAt = new Date();
    const wb = buildRatesWorkbook({
      rows: overview.rows,
      counts: overview.counts,
      litresMeasured: overview.litresMeasured,
      litresTotal: overview.litresTotal,
      portable,
      rawBasis: new Map(basisRows.map((r) => [r.assetId, r.fuelConsBasis])),
      generatedAt,
      exportedBy: session.name,
    });

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ratesWorkbookFilename(generatedAt)}"`,
      },
    });
  } catch (err: unknown) {
    console.error("Rates XLSX export error:", err);
    return new NextResponse(errorMessageOr(err, "Failed to build the rates workbook"), { status: 500 });
  }
}
