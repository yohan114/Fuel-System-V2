import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSiteUser } from "@/lib/roles";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import { buildMonthlySiteFuel, UNASSIGNED_ID, excelSheetName } from "@/lib/reports/monthly-site-fuel";
import { errorMessageOr } from "@/lib/errors";
import * as XLSX from "xlsx";

// Monthly fuel-issue summary sheet, site by site. Sheet 1 is the site rollup,
// sheet 2 the machine-level breakdown, sheet 3 the reconciliation proving every
// issue of the month landed on exactly one site.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const y = parseInt(searchParams.get("year") || "", 10);
  const m = parseInt(searchParams.get("month") || "", 10);
  const period = y && m >= 1 && m <= 12 ? resolvePeriod(y, m) : currentMonthPeriod(new Date());
  const projectId = isSiteUser(session.role) ? session.projectId ?? undefined : undefined;

  try {
    const r = await buildMonthlySiteFuel({ year: period.year, month: period.month, projectId });
    const lkr = (cents: number) => Math.round(cents) / 100;
    const wb = XLSX.utils.book_new();

    // --- Sheet 1: site summary ------------------------------------------------
    const summary: (string | number)[][] = [
      [`Monthly Fuel Issue Summary — Site Wise — ${r.period.label}`],
      [],
      ["Site Code", "Site", "Machines", "Issues", "Litres", "Cost (LKR)", "By Posting", "By Tank"],
    ];
    for (const s of r.sites)
      summary.push([s.code, s.name, s.machineCount, s.issueCount, s.litres, lkr(s.costCents), s.byRule.posted, s.byRule.tank]);
    summary.push([]);
    summary.push(["", "TOTAL", r.totals.machineCount, r.totals.issueCount, r.totals.litres, lkr(r.totals.costCents), r.byRule.posted, r.byRule.tank]);
    const ws1 = XLSX.utils.aoa_to_sheet(summary);
    ws1["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 10 }];
    ws1["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
    XLSX.utils.book_append_sheet(wb, ws1, "Site Summary");

    // --- One worksheet per site: that site's vehicles for the month ----------
    const taken = new Set<string>(["site summary", "reconciliation"]);
    for (const s of r.sites) {
      const rows: (string | number)[][] = [
        [`${s.name} (${s.code}) — Fuel Issues — ${r.period.label}`],
        [],
        ["Vehicle", "Description", "Fuel Issues", "Quantity (L)", "Cost (LKR)", "Assigned By"],
      ];
      for (const mac of s.machines)
        rows.push([
          mac.code, mac.label, mac.issueCount, mac.litres, lkr(mac.costCents),
          mac.postedIssues === mac.issueCount ? "posting" : `${mac.postedIssues} posting / ${mac.issueCount - mac.postedIssues} tank`,
        ]);
      rows.push([]);
      rows.push(["TOTAL", `${s.machineCount} vehicles`, s.issueCount, s.litres, lkr(s.costCents), ""]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 24 }];
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
      // Tab named for the site, sanitised to what Excel accepts.
      XLSX.utils.book_append_sheet(wb, ws, excelSheetName(s.name, taken));
    }

    // --- Sheet 3: how every issue was assigned -------------------------------
    const checks: (string | number)[][] = [
      [`Attribution & Reconciliation — ${r.period.label}`],
      [],
      ["Fuel issues recorded in the month", r.reconciliation.issuesInMonth],
      ["Fuel issues placed on this sheet", r.reconciliation.issuesOnSheet],
      ["Litres recorded in the month", r.reconciliation.litresInMonth],
      ["Litres placed on this sheet", r.reconciliation.litresOnSheet],
      ["Balanced", r.reconciliation.balanced ? "YES — every issue assigned to exactly one site" : "NO — see unassigned rows"],
      ["Voided issues excluded", r.voidedExcluded],
      [],
      ["How each issue was assigned to a site"],
      ["Posting on the issue date (site the machine was assigned to)", r.byRule.posted],
      ["Tank the fuel was drawn from (machine had no posting that day)", r.byRule.tank],
      ["Machine's current site (tank had no site)", r.byRule.current],
      ["Unassigned (no route to any site)", r.byRule.unassigned],
      [],
      ["Rule order: posting first, then the tank the fuel physically came from, then the machine's current site."],
      ["A posted machine always counts against its posting, never against the pump it fuelled at."],
    ];
    if (r.sites.some((s) => s.projectId === UNASSIGNED_ID))
      checks.push([], ["WARNING: some issues could not be routed to a site — see the Unassigned row on Sheet 1."]);
    const ws3 = XLSX.utils.aoa_to_sheet(checks);
    ws3["!cols"] = [{ wch: 62 }, { wch: 46 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Reconciliation");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const name = `fuel-issues-by-site-${r.period.periodKey}.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err: unknown) {
    console.error("Site fuel sheet export error:", err);
    return new NextResponse(errorMessageOr(err, "Failed to build the sheet"), { status: 500 });
  }
}
