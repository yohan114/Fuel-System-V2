import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aggregateServiceData } from "@/lib/reports/service-report";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: "#333" },
  header: { marginBottom: 16, borderBottomWidth: 1, borderBottomColor: "#ddd", paddingBottom: 10 },
  title: { fontSize: 15, fontWeight: "bold", color: "#111" },
  subtitle: { fontSize: 9, color: "#666", marginTop: 4 },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  kpiBox: { padding: 8, borderWidth: 1, borderColor: "#eee", borderRadius: 5, width: "23%", marginRight: "2%", marginBottom: 6 },
  kpiLabel: { fontSize: 7, color: "#888", textTransform: "uppercase" },
  kpiValue: { fontSize: 10, fontWeight: "bold", marginTop: 3, color: "#111" },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginTop: 14, marginBottom: 6, color: "#111" },
  th: { flexDirection: "row", backgroundColor: "#f5f6f8", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 4, paddingHorizontal: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 3, paddingHorizontal: 3 },
  c: { fontSize: 8 },
  cr: { fontSize: 8, textAlign: "right" },
});

const rs = (c: number) => "Rs. " + (c / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });

function ServiceReport({ d, fromStr, toStr }: { d: any; fromStr: string; toStr: string }) {
  const topV = d.topVehicles.slice(0, 25);
  const topF = d.filtersUsed.slice(0, 25);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>EDWARD & CHRISTIE (E&C) — SERVICE & MAINTENANCE</Text>
          <Text style={styles.subtitle}>Service spend report | Period: {fromStr} to {toStr}</Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Total Spend</Text><Text style={styles.kpiValue}>{rs(d.totalCents)}</Text></View>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Parts</Text><Text style={styles.kpiValue}>{rs(d.partsCents)}</Text></View>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Labour</Text><Text style={styles.kpiValue}>{rs(d.labourCents)}</Text></View>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Sundry</Text><Text style={styles.kpiValue}>{rs(d.sundryCents)}</Text></View>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Records</Text><Text style={styles.kpiValue}>{d.recordCount}</Text></View>
          <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Vehicles</Text><Text style={styles.kpiValue}>{d.vehicleCount}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Spend by Site</Text>
        <View style={styles.th}>
          <Text style={[styles.c, { width: "55%" }]}>Site</Text>
          <Text style={[styles.cr, { width: "20%" }]}>Services</Text>
          <Text style={[styles.cr, { width: "25%" }]}>Spend</Text>
        </View>
        {d.bySite.map((s: any, i: number) => (
          <View style={styles.tr} key={i}>
            <Text style={[styles.c, { width: "55%" }]}>{s.name} ({s.code})</Text>
            <Text style={[styles.cr, { width: "20%" }]}>{s.count}</Text>
            <Text style={[styles.cr, { width: "25%" }]}>{rs(s.cents)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Top Vehicles by Spend</Text>
        <View style={styles.th}>
          <Text style={[styles.c, { width: "18%" }]}>E&C No.</Text>
          <Text style={[styles.c, { width: "37%" }]}>Category</Text>
          <Text style={[styles.c, { width: "15%" }]}>Site</Text>
          <Text style={[styles.cr, { width: "12%" }]}>Svcs</Text>
          <Text style={[styles.cr, { width: "18%" }]}>Spend</Text>
        </View>
        {topV.map((v: any, i: number) => (
          <View style={styles.tr} key={i}>
            <Text style={[styles.c, { width: "18%" }]}>{v.code}</Text>
            <Text style={[styles.c, { width: "37%" }]}>{v.category}</Text>
            <Text style={[styles.c, { width: "15%" }]}>{v.site || "—"}</Text>
            <Text style={[styles.cr, { width: "12%" }]}>{v.count}</Text>
            <Text style={[styles.cr, { width: "18%" }]}>{rs(v.cents)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Top Filters Consumed</Text>
        <View style={styles.th}>
          <Text style={[styles.c, { width: "35%" }]}>Filter No.</Text>
          <Text style={[styles.c, { width: "37%" }]}>Category</Text>
          <Text style={[styles.cr, { width: "12%" }]}>Qty</Text>
          <Text style={[styles.cr, { width: "16%" }]}>Spend</Text>
        </View>
        {topF.map((f: any, i: number) => (
          <View style={styles.tr} key={i}>
            <Text style={[styles.c, { width: "35%" }]}>{f.filterNo || "(no part no.)"}</Text>
            <Text style={[styles.c, { width: "37%" }]}>{f.category}</Text>
            <Text style={[styles.cr, { width: "12%" }]}>{f.qty}</Text>
            <Text style={[styles.cr, { width: "16%" }]}>{rs(f.cents)}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  if (!fromStr || !toStr) return new NextResponse("Missing required parameters: from, to", { status: 400 });

  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T23:59:59Z`);
  const projectId = session.role === "USER" && session.projectId ? session.projectId : undefined;

  try {
    const d = await aggregateServiceData({ from, to, projectId });
    const stream = await renderToStream(<ServiceReport d={d} fromStr={fromStr} toStr={toStr} />);
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="service_report_${fromStr}_to_${toStr}.pdf"`);
    return response;
  } catch (err) {
    console.error("Service PDF error:", err);
    return new NextResponse("Failed to compile PDF document.", { status: 500 });
  }
}
