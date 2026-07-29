import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fuelKindLabel } from "@/lib/fuel-kinds";
import { buildFuelIssueReport, parseRange, ymd, type FuelReport } from "@/lib/fuel/issue-report";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

// PDF export of the Fuel Issue Report. Shares buildFuelIssueReport with the
// screen and the Excel export, so all three always agree — including the
// site-user scoping, which is applied inside that helper.
//
// The proxy already guards this path; the session is re-checked here so the
// export cannot be reached if that exemption list ever changes.

const styles = StyleSheet.create({
  page: { paddingHorizontal: 28, paddingVertical: 30, fontFamily: "Helvetica", fontSize: 8, color: "#333333" },
  header: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: "#dddddd", paddingBottom: 8 },
  title: { fontSize: 14, fontWeight: "bold", color: "#111111" },
  subtitle: { fontSize: 8, color: "#666666", marginTop: 3 },

  kpiRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  kpiBox: { padding: 8, borderWidth: 1, borderColor: "#eeeeee", borderRadius: 4, width: "23%" },
  kpiLabel: { fontSize: 6, color: "#777777", textTransform: "uppercase" },
  kpiValue: { fontSize: 10, fontWeight: "bold", marginTop: 3 },

  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eeeeee", paddingVertical: 4 },
  headRow: { backgroundColor: "#f5f6f8", fontWeight: "bold", borderBottomWidth: 1, borderBottomColor: "#cccccc" },
  totalRow: { flexDirection: "row", borderTopWidth: 1.5, borderTopColor: "#999999", paddingVertical: 5, marginTop: 2 },

  cDate: { width: "10%" },
  cVeh: { width: "16%" },
  cSite: { width: "10%" },
  cFuel: { width: "12%" },
  cLit: { width: "9%", textAlign: "right" },
  cCost: { width: "13%", textAlign: "right" },
  cMeter: { width: "12%", textAlign: "right" },
  cBy: { width: "18%" },

  cell: { fontSize: 7 },
  cellBold: { fontSize: 7, fontWeight: "bold" },
  voided: { fontSize: 7, color: "#999999", textDecoration: "line-through" },
  note: { fontSize: 7, color: "#a06000", marginTop: 8 },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 6, color: "#999999", textAlign: "center" },
});

function money(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
}

function ReportDocument({
  report,
  scope,
  vehicle,
  fromStr,
  toStr,
  generatedBy,
}: {
  report: FuelReport;
  scope: string;
  vehicle: string;
  fromStr: string;
  toStr: string;
  generatedBy: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>EDWARD &amp; CHRISTIE (E&amp;C) CONSTRUCTION FLEET</Text>
          <Text style={styles.subtitle}>
            Fuel Issue Report · {scope} · {vehicle} · {fromStr} to {toStr}
          </Text>
          <Text style={styles.subtitle}>
            Fuel is attributed to each vehicle&apos;s allocated site on the day of issue.
          </Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Total Litres</Text>
            <Text style={styles.kpiValue}>{report.totals.litres.toLocaleString("en-LK", { maximumFractionDigits: 1 })} L</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Total Cost</Text>
            <Text style={styles.kpiValue}>{money(report.totals.costCents)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Fuel Issues</Text>
            <Text style={styles.kpiValue}>{report.totals.issueCount.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Vehicles</Text>
            <Text style={styles.kpiValue}>{report.totals.vehicleCount.toLocaleString()}</Text>
          </View>
        </View>

        <View style={[styles.row, styles.headRow]} fixed>
          <Text style={[styles.cellBold, styles.cDate]}>Date</Text>
          <Text style={[styles.cellBold, styles.cVeh]}>Vehicle</Text>
          <Text style={[styles.cellBold, styles.cSite]}>Site</Text>
          <Text style={[styles.cellBold, styles.cFuel]}>Fuel</Text>
          <Text style={[styles.cellBold, styles.cLit]}>Litres</Text>
          <Text style={[styles.cellBold, styles.cCost]}>Cost</Text>
          <Text style={[styles.cellBold, styles.cMeter]}>Meter</Text>
          <Text style={[styles.cellBold, styles.cBy]}>Issued By</Text>
        </View>

        {report.rows.map((r) => {
          const s = r.voided ? styles.voided : styles.cell;
          return (
            <View key={r.id} style={styles.row} wrap={false}>
              <Text style={[s, styles.cDate]}>
                {new Date(r.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
              </Text>
              <Text style={[s, styles.cVeh]}>{r.assetCode}</Text>
              <Text style={[s, styles.cSite]}>{r.siteCode ?? "—"}</Text>
              <Text style={[s, styles.cFuel]}>{fuelKindLabel(r.fuelKind)}</Text>
              <Text style={[s, styles.cLit]}>{r.litres.toLocaleString()}</Text>
              <Text style={[s, styles.cCost]}>{money(r.totalCostCents)}</Text>
              <Text style={[s, styles.cMeter]}>
                {r.meterReading !== null ? `${r.meterReading.toLocaleString()} ${r.readingType ?? ""}` : "—"}
              </Text>
              <Text style={[s, styles.cBy]}>{r.issuedByName}</Text>
            </View>
          );
        })}

        {report.rows.length === 0 && (
          <Text style={{ fontSize: 8, color: "#888888", marginTop: 16, textAlign: "center" }}>
            No fuel issues match these filters.
          </Text>
        )}

        {report.rows.length > 0 && (
          <View style={styles.totalRow}>
            <Text style={[styles.cellBold, styles.cDate]}>TOTAL</Text>
            <Text style={[styles.cellBold, styles.cVeh]}>{report.totals.issueCount} issues</Text>
            <Text style={[styles.cellBold, styles.cSite]} />
            <Text style={[styles.cellBold, styles.cFuel]} />
            <Text style={[styles.cellBold, styles.cLit]}>
              {report.totals.litres.toLocaleString("en-LK", { maximumFractionDigits: 1 })}
            </Text>
            <Text style={[styles.cellBold, styles.cCost]}>{money(report.totals.costCents)}</Text>
            <Text style={[styles.cellBold, styles.cMeter]} />
            <Text style={[styles.cellBold, styles.cBy]} />
          </View>
        )}

        {report.truncated && (
          <Text style={styles.note}>
            Capped at the first {report.rows.length} rows — narrow the date range or pick a
            site for a complete report.
          </Text>
        )}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Generated ${new Date().toLocaleString("en-GB")} by ${generatedBy}  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const sp = request.nextUrl.searchParams;
  const { from, to } = parseRange(sp.get("from"), sp.get("to"));
  const siteId = sp.get("site");
  const vehicle = sp.get("vehicle");
  const fuelKind = sp.get("fuelKind");

  try {
    const report = await buildFuelIssueReport(
      { from, to, siteId, vehicle, fuelKind },
      { role: session.role, projectId: session.projectId },
    );

    const site = siteId ? await prisma.project.findUnique({ where: { id: siteId }, select: { name: true, code: true } }) : null;
    const scope = site ? `${site.name} (${site.code})` : "All sites";

    const stream = await renderToStream(
      <ReportDocument
        report={report}
        scope={scope}
        vehicle={vehicle ? vehicle.toUpperCase() : "All vehicles"}
        fromStr={ymd(from)}
        toStr={ymd(to)}
        generatedBy={session.name}
      />,
    );

    const name = `fuel-issues_${site?.code ?? "all-sites"}${vehicle ? `_${vehicle.toUpperCase()}` : ""}_${ymd(from)}_to_${ymd(to)}.pdf`;
    const response = new NextResponse(stream as unknown as BodyInit);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="${name}"`);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    console.error("Fuel report PDF error:", err);
    return new NextResponse("Failed to compile the PDF report.", { status: 500 });
  }
}
