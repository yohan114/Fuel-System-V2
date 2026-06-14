import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

// Define PDF Document styling
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 9, color: "#333333" },
  header: { marginBottom: 20, borderBottomWidth: 1, borderBottomColor: "#dddddd", paddingBottom: 10 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111111" },
  subtitle: { fontSize: 9, color: "#666666", marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginTop: 20, marginBottom: 8, color: "#111111" },
  kpiContainer: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  kpiBox: { padding: 10, borderWidth: 1, borderColor: "#eeeeee", borderRadius: 6, width: "30%" },
  kpiLabel: { fontSize: 7, color: "#777777", textTransform: "uppercase" },
  kpiValue: { fontSize: 11, fontWeight: "bold", marginTop: 4 },
  
  table: { width: "100%", marginTop: 5 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eeeeee", paddingVertical: 5 },
  tableHeader: { backgroundColor: "#f5f6f8", fontWeight: "bold" },
  colCode: { width: "20%" },
  colName: { width: "30%" },
  colLitres: { width: "15%" },
  colCost: { width: "20%" },
  colEff: { width: "15%", textAlign: "right" },
  
  cellText: { fontSize: 8 },
  cellBold: { fontSize: 8, fontWeight: "bold" }
});

// PDF document component
function ReportDocument({ data, fromStr, toStr }: { data: any; fromStr: string; toStr: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>EDWARD & CHRISTIE (E&C) CONSTRUCTION FLEET</Text>
          <Text style={styles.subtitle}>Fuel Utilization and Spend Audit Report | Period: {fromStr} to {toStr}</Text>
        </View>

        {/* KPI Summary Cards */}
        <View style={styles.kpiContainer}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Total Spend</Text>
            <Text style={styles.kpiValue}>Rs. {(data.totalCostCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Volume Pumped</Text>
            <Text style={styles.kpiValue}>{data.totalLitres.toLocaleString()} L</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Dispatch Logs</Text>
            <Text style={styles.kpiValue}>{data.issueCount} events</Text>
          </View>
        </View>

        {/* Categories Table */}
        <Text style={styles.sectionTitle}>Consumption by Asset Category</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.colName, styles.cellBold]}>Category Name</Text>
            <Text style={[styles.colCode, styles.cellBold]}>Category Code</Text>
            <Text style={[styles.colLitres, styles.cellBold]}>Volume (L)</Text>
            <Text style={[styles.colCost, styles.cellBold]}>Spend (LKR)</Text>
          </View>
          {data.categoryBreakdown.map((cat: any, idx: number) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.colName, styles.cellText]}>{cat.name}</Text>
              <Text style={[styles.colCode, styles.cellText]}>{cat.code}</Text>
              <Text style={[styles.colLitres, styles.cellText]}>{cat.litres.toFixed(1)} L</Text>
              <Text style={[styles.colCost, styles.cellText]}>Rs. {(cat.costCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}</Text>
            </View>
          ))}
        </View>

        {/* Top Consumers Table */}
        <Text style={styles.sectionTitle}>Top Asset Consumers & Efficiency Rates</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.colCode, styles.cellBold]}>E&C Number</Text>
            <Text style={[styles.colName, styles.cellBold]}>Specifications</Text>
            <Text style={[styles.colLitres, styles.cellBold]}>Volume (L)</Text>
            <Text style={[styles.colCost, styles.cellBold]}>Cost (LKR)</Text>
            <Text style={[styles.colEff, styles.cellBold]}>Economy</Text>
          </View>
          {data.assetBreakdown.slice(0, 12).map((asset: any, idx: number) => {
            const formattedEff = asset.efficiency !== null
              ? asset.meterType === "KM"
                ? `${asset.efficiency.toFixed(2)} km/L`
                : `${asset.efficiency.toFixed(2)} L/hr`
              : "—";

            return (
              <View key={idx} style={styles.tableRow}>
                <Text style={[styles.colCode, styles.cellText]}>{asset.code}</Text>
                <Text style={[styles.colName, styles.cellText]}>{asset.brand || ""} {asset.typeLabel || ""}</Text>
                <Text style={[styles.colLitres, styles.cellText]}>{asset.litres.toFixed(1)} L</Text>
                <Text style={[styles.colCost, styles.cellText]}>Rs. {(asset.costCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}</Text>
                <Text style={[styles.colEff, styles.cellText]}>{formattedEff}</Text>
              </View>
            );
          })}
        </View>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  // 1. Verify credentials
  const session = await getSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Extract and parse parameters
  const { searchParams } = request.nextUrl;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (!fromStr || !toStr) {
    return new NextResponse("Missing required date boundaries: from, to", { status: 400 });
  }

  const fromDate = new Date(`${fromStr}T00:00:00Z`);
  const toDate = new Date(`${toStr}T23:59:59Z`);

  try {
    const data = await aggregateFuelData({ from: fromDate, to: toDate });
    const stream = await renderToStream(<ReportDocument data={data} fromStr={fromStr} toStr={toStr} />);
    
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="fuel_audit_${fromStr}_to_${toStr}.pdf"`);
    return response;
  } catch (err: any) {
    console.error("PDF generation error:", err);
    return new NextResponse("Failed to compile PDF document.", { status: 500 });
  }
}
