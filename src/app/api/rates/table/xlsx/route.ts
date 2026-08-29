import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { billingScope } from "@/lib/roles";
import { getRatesOverview } from "@/lib/consumption/rates-overview";
import { asRateFilter, filterRateRows, describeRateQuery } from "@/lib/consumption/rates-filter";
import { buildRatesTableWorkbook, ratesTableFilename } from "@/lib/reports/rates-workbook";
import { errorMessageOr } from "@/lib/errors";
import * as XLSX from "xlsx";

// The Fuel & Rental Rates table as one Excel page.
//
// /api/rates/xlsx gives the whole picture across seven sheets. This gives the
// one thing somebody usually wants: the table in front of them, on a single
// sheet, with the filter and search they had applied still applied.
//
// The filter arrives as query parameters because it is client state — which is
// also why the predicate itself lives in lib/consumption/rates-filter and is
// imported by both the table component and this route. Two copies would drift,
// and an export that silently returns different rows from the ones on screen is
// worse than no export.
//
// Same gate as the full workbook: this is the fleet's commercial rate card, so
// administrators and allocators only.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (billingScope(session).kind !== "all") {
    return new NextResponse("Forbidden — the rate card export is for administrators and allocators.", { status: 403 });
  }

  try {
    const params = request.nextUrl.searchParams;
    // An unrecognised filter falls back to "all" rather than erroring: a stale
    // bookmark should hand back the whole table, not a 400.
    const query = { q: params.get("q") ?? "", filter: asRateFilter(params.get("filter")) };

    const { rows } = await getRatesOverview();
    const shown = filterRateRows(rows, query);

    const generatedAt = new Date();
    const wb = buildRatesTableWorkbook({
      rows: shown,
      scopeNote: describeRateQuery(query, shown.length, rows.length),
      generatedAt,
      exportedBy: session.name,
    });

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ratesTableFilename(generatedAt)}"`,
      },
    });
  } catch (err: unknown) {
    console.error("Rates table XLSX export error:", err);
    return new NextResponse(errorMessageOr(err, "Failed to build the sheet"), { status: 500 });
  }
}
