import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fuelViewScope } from "@/lib/fuel/view-scope";
import { buildFuelIssueReport, parseReportParams, reportFilterForScope, type FuelIssueReport } from "@/lib/reports/fuel-issue-report";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

// The printable Fuel Issue Report — the sheet that gets signed and handed over.
//
// Same query string, same builder as the screen and the Excel, so the three
// cannot drift apart.

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: "Helvetica", fontSize: 8, color: "#333" },
  header: { marginBottom: 12, borderBottomWidth: 1, borderBottomColor: "#ddd", paddingBottom: 8 },
  title: { fontSize: 14, fontWeight: "bold", color: "#111" },
  subtitle: { fontSize: 8, color: "#666", marginTop: 3 },
  kpiRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  kpi: { padding: 7, borderWidth: 1, borderColor: "#eee", borderRadius: 4, width: "23.5%" },
  kpiLabel: { fontSize: 6, color: "#777", textTransform: "uppercase" },
  kpiValue: { fontSize: 10, fontWeight: "bold", marginTop: 3 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 3 },
  head: { backgroundColor: "#f5f6f8", fontWeight: "bold" },
  total: { backgroundColor: "#f5f6f8", fontWeight: "bold", borderTopWidth: 1, borderTopColor: "#ccc" },
  cell: { fontSize: 7, paddingHorizontal: 2 },
  cDate: { width: "10%" }, cVeh: { width: "14%" }, cSite: { width: "10%" }, cFuel: { width: "12%" },
  cLit: { width: "8%", textAlign: "right" }, cCost: { width: "12%", textAlign: "right" },
  cMeter: { width: "12%", textAlign: "right" }, cBy: { width: "10%" }, cPump: { width: "12%" },
  note: { fontSize: 7, color: "#888", marginTop: 10 },
  foot: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 6, color: "#999",
    borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
});

const rs = (c: number) => Math.round(c / 100).toLocaleString("en-LK");

function Doc({ report, title, from, to, vehicle, fuelKind }:
  { report: FuelIssueReport; title: string; from: string; to: string; vehicle: string; fuelKind: string }) {
  const filters = [vehicle && `vehicle ${vehicle}`, fuelKind && fuelKind.replace(/_/g, " ")].filter(Boolean).join(" · ");
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>EDWARD &amp; CHRISTIE (PVT) LTD — FUEL ISSUE REPORT</Text>
          <Text style={s.subtitle}>{title} · {from} to {to}{filters ? ` · ${filters}` : ""}</Text>
          <Text style={s.subtitle}>
            Fuel is attributed to the vehicle&apos;s allocated site on the day it was issued, not to the pump it was drawn from.
          </Text>
        </View>

        <View style={s.kpiRow}>
          {[
            ["Total litres", `${report.totals.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`],
            ["Total cost", `Rs. ${rs(report.totals.costCents)}`],
            ["Fuel issues", String(report.totals.issues)],
            ["Vehicles", String(report.totals.vehicles)],
          ].map(([l, v]) => (
            <View key={l} style={s.kpi}>
              <Text style={s.kpiLabel}>{l}</Text>
              <Text style={s.kpiValue}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={[s.row, s.head]}>
          <Text style={[s.cell, s.cDate]}>Date</Text>
          <Text style={[s.cell, s.cVeh]}>Vehicle</Text>
          <Text style={[s.cell, s.cSite]}>Site</Text>
          <Text style={[s.cell, s.cFuel]}>Fuel</Text>
          <Text style={[s.cell, s.cLit]}>Litres</Text>
          <Text style={[s.cell, s.cCost]}>Cost (Rs.)</Text>
          <Text style={[s.cell, s.cMeter]}>Meter</Text>
          <Text style={[s.cell, s.cBy]}>Issued by</Text>
          <Text style={[s.cell, s.cPump]}>Pump</Text>
        </View>

        {report.rows.map((r) => (
          <View key={r.id} style={s.row} wrap={false}>
            <Text style={[s.cell, s.cDate]}>{r.day}</Text>
            <Text style={[s.cell, s.cVeh]}>{r.assetCode}{r.assetRegNo ? ` (${r.assetRegNo})` : ""}</Text>
            <Text style={[s.cell, s.cSite]}>{r.siteCode ?? "—"}</Text>
            <Text style={[s.cell, s.cFuel]}>{r.fuelKind.replace(/_/g, " ")}</Text>
            <Text style={[s.cell, s.cLit]}>{r.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Text>
            <Text style={[s.cell, s.cCost]}>{rs(r.costCents)}</Text>
            <Text style={[s.cell, s.cMeter]}>{r.meterReading != null ? `${r.meterReading.toLocaleString()} ${r.readingType ?? ""}` : "—"}</Text>
            <Text style={[s.cell, s.cBy]}>{r.issuedBy}</Text>
            <Text style={[s.cell, s.cPump]}>{r.pumpName ?? "—"}</Text>
          </View>
        ))}

        <View style={[s.row, s.total]}>
          <Text style={[s.cell, s.cDate]}>TOTAL</Text>
          <Text style={[s.cell, s.cVeh]}>{report.totals.vehicles} vehicles</Text>
          <Text style={[s.cell, s.cSite]}></Text>
          <Text style={[s.cell, s.cFuel]}>{report.totals.issues} issues</Text>
          <Text style={[s.cell, s.cLit]}>{report.totals.litres.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Text>
          <Text style={[s.cell, s.cCost]}>{rs(report.totals.costCents)}</Text>
          <Text style={[s.cell, s.cMeter]}></Text>
          <Text style={[s.cell, s.cBy]}></Text>
          <Text style={[s.cell, s.cPump]}></Text>
        </View>

        {report.truncated && (
          <Text style={s.note}>Capped at the first 5,000 issues. Narrow the date range to see the rest.</Text>
        )}

        <View style={s.foot} fixed>
          <Text>Generated {new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} (Asia/Colombo)</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const p = parseReportParams((k) => searchParams.get(k));
  // The printout carries the reader's scope, not the query string's — this route
  // is a URL anyone logged in can type.
  const scoped = reportFilterForScope(await fuelViewScope(session), p.site);
  const siteId = scoped.projectId ?? scoped.pumpProjectId;

  try {
    const [report, site] = await Promise.all([
      buildFuelIssueReport({ from: p.from, to: p.to, vehicle: p.vehicle, fuelKind: p.fuelKind, ...scoped }),
      siteId ? prisma.project.findUnique({ where: { id: siteId }, select: { code: true, name: true } }) : null,
    ]);

    const stream = await renderToStream(
      <Doc report={report}
        title={site ? `${site.name} (${site.code})${scoped.pumpProjectId ? " — issued from this site's pump" : ""}` : "All sites"}
        from={p.fromStr} to={p.toStr} vehicle={p.vehicle} fuelKind={p.fuelKind} />
    );
    const name = `fuel-issues-${site?.code ?? "all-sites"}-${p.fromStr}-to-${p.toStr}.pdf`;
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` },
    });
  } catch (err) {
    console.error("fuel issue report pdf failed", err);
    return new NextResponse("Failed to build the report", { status: 500 });
  }
}
