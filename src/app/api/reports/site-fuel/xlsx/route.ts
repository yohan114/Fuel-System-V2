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

    // --- One worksheet per site: that site's vehicles, then every issue ------
    // Both numbers are carried on every row. The yard works in E&C codes, the
    // driver's paperwork and the site's own registers in plates, and neither
    // alone identifies a machine — ten registrations in this fleet are shared
    // by two or three assets. Anyone reconciling this sheet against a daily
    // issue note needs the plate; anyone reconciling it against the fleet
    // register needs the code.
    const taken = new Set<string>(["site summary", "reconciliation", "all issues"]);
    for (const s of r.sites) {
      const rows: (string | number)[][] = [
        [`${s.name} (${s.code}) — Fuel Issues — ${r.period.label}`],
        [],
        ["E&C No.", "Vehicle No.", "Description", "Fuel Issues", "Quantity (L)", "Cost (LKR)", "Assigned By"],
      ];
      for (const mac of s.machines)
        rows.push([
          mac.code, mac.regNo ?? "", mac.label, mac.issueCount, mac.litres, lkr(mac.costCents),
          mac.postedIssues === mac.issueCount ? "posting" : `${mac.postedIssues} posting / ${mac.issueCount - mac.postedIssues} tank`,
        ]);
      rows.push([]);
      rows.push(["TOTAL", "", `${s.machineCount} vehicles`, s.issueCount, s.litres, lkr(s.costCents), ""]);

      // The same machines again, expanded issue by issue, vehicle by vehicle —
      // the sheet equivalent of opening a row on the screen. Kept on the site's
      // own tab rather than a separate workbook so a site can be sent one tab.
      rows.push([], []);
      rows.push([`Every fuel issue, vehicle by vehicle — ${s.name} (${s.code})`]);
      const detailHeaderRow = rows.length;
      rows.push(["E&C No.", "Vehicle No.", "Date", "Pump (site)", "Quantity (L)", "Rate (LKR/L)", "Cost (LKR)", "Meter", "Unit", "Issued To", "Attributed By", "Source"]);
      for (const mac of s.machines) {
        for (const i of mac.issues) {
          rows.push([
            mac.code,
            mac.regNo ?? "",
            i.day,
            // Flagged when the machine fuelled somewhere other than the site it
            // is billed to, which is normal for a travelling machine and looks
            // like an error when it is not explained.
            i.tankSite ? (i.tankSite === s.code ? i.tankSite : `${i.tankSite} (visiting)`) : "—",
            i.litres,
            lkr(i.pricePerLitre),
            lkr(i.costCents),
            i.meterReading ?? "",
            i.readingType ?? "",
            i.issuePerson ?? "",
            i.rule,
            i.source ?? "",
          ]);
        }
        // A blank line between machines so the tab reads as a set of vehicles
        // rather than one undifferentiated list.
        if (mac.issues.length) rows.push([]);
      }
      rows.push(["TOTAL", "", "", "", s.litres, "", lkr(s.costCents), "", "", "", "", ""]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 13 }, { wch: 12 },
        { wch: 15 }, { wch: 12 }, { wch: 7 }, { wch: 20 }, { wch: 13 }, { wch: 34 },
      ];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
        { s: { r: detailHeaderRow - 1, c: 0 }, e: { r: detailHeaderRow - 1, c: 11 } },
      ];
      // Tab named for the site, sanitised to what Excel accepts.
      XLSX.utils.book_append_sheet(wb, ws, excelSheetName(s.name, taken));
    }

    // --- Every issue in the month on one tab, for filtering and pivoting -----
    // The per-site tabs are for reading; this one is for working with. It is
    // deliberately flat — one row per issue, no blank separators, no totals —
    // so Excel's own filters and pivot tables work on it without cleaning.
    const all: (string | number)[][] = [
      ["Site Code", "Site", "E&C No.", "Vehicle No.", "Description", "Date", "Pump (site)", "Quantity (L)", "Rate (LKR/L)", "Cost (LKR)", "Meter", "Unit", "Issued To", "Attributed By", "Source"],
    ];
    for (const s of r.sites)
      for (const mac of s.machines)
        for (const i of mac.issues)
          all.push([
            s.code, s.name, mac.code, mac.regNo ?? "", mac.label, i.day,
            i.tankSite ?? "", i.litres, lkr(i.pricePerLitre), lkr(i.costCents),
            i.meterReading ?? "", i.readingType ?? "", i.issuePerson ?? "", i.rule, i.source ?? "",
          ]);
    const wsAll = XLSX.utils.aoa_to_sheet(all);
    wsAll["!cols"] = [
      { wch: 11 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
      { wch: 13 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 7 }, { wch: 20 }, { wch: 13 }, { wch: 34 },
    ];
    // Autofilter on the header so the tab is usable the moment it opens.
    // No frozen header pane: this build of SheetJS (0.18.5, community) does not
    // write panes, and setting "!freeze" would look like it had worked.
    wsAll["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(all.length - 1, 1), c: 14 } }) };
    XLSX.utils.book_append_sheet(wb, wsAll, "All Issues");

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
