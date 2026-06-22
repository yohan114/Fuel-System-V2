import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";
import { fmtServiceDate } from "@/lib/service/format";

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: "#222" },
  header: { borderBottomWidth: 2, borderBottomColor: "#111", paddingBottom: 8, marginBottom: 12 },
  company: { fontSize: 14, fontWeight: "bold", color: "#111" },
  title: { fontSize: 10, color: "#555", marginTop: 2 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  metaCell: { width: "33%", marginBottom: 6 },
  metaLabel: { fontSize: 7, color: "#888", textTransform: "uppercase" },
  metaValue: { fontSize: 9, fontWeight: "bold", color: "#111", marginTop: 1 },
  sectionTitle: { fontSize: 10, fontWeight: "bold", marginTop: 10, marginBottom: 4, color: "#111" },
  table: { width: "100%" },
  th: { flexDirection: "row", backgroundColor: "#f0f1f4", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 3, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 3, paddingHorizontal: 4 },
  cell: { fontSize: 8 },
  cellR: { fontSize: 8, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: "45%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#111", marginTop: 2 },
  footer: { marginTop: 24, fontSize: 7, color: "#999", textAlign: "center" },
});

const rs = (c: number | null | undefined) => "Rs. " + ((c ?? 0) / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (x: Date) => fmtServiceDate(x, { day: "2-digit", month: "short", year: "numeric" });

function ServiceSheet({ rec }: { rec: any }) {
  const unit = rec.meterType === "KM" ? "km" : "hr";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>EDWARD & CHRISTIE (PVT) LTD</Text>
          <Text style={styles.title}>Vehicle / Machinery Service Details</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Vehicle</Text><Text style={styles.metaValue}>{rec.asset.code}{rec.asset.regNo ? ` (${rec.asset.regNo})` : ""}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Make / Model</Text><Text style={styles.metaValue}>{[rec.asset.brand, rec.asset.model].filter(Boolean).join(" ") || "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Service date</Text><Text style={styles.metaValue}>{d(rec.serviceDate)}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Job no.</Text><Text style={styles.metaValue}>{rec.jobNo || "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Site</Text><Text style={styles.metaValue}>{rec.siteLocation || "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Service type</Text><Text style={styles.metaValue}>{rec.serviceType || "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Meter</Text><Text style={styles.metaValue}>{rec.meterAtService != null ? `${rec.meterAtService.toLocaleString()} ${unit}` : "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Next service</Text><Text style={styles.metaValue}>{rec.nextServiceMeter != null ? `${rec.nextServiceMeter.toLocaleString()} ${unit}` : "—"}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaLabel}>Upkeeping</Text><Text style={styles.metaValue}>{rec.upkeepingStatus || "—"}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Oils</Text>
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cell, { width: "40%" }]}>Oil</Text>
            <Text style={[styles.cell, { width: "30%" }]}>Grade</Text>
            <Text style={[styles.cellR, { width: "15%" }]}>Qty</Text>
            <Text style={[styles.cellR, { width: "15%" }]}>Price</Text>
          </View>
          {rec.oils.length === 0 ? (
            <View style={styles.tr}><Text style={styles.cell}>None</Text></View>
          ) : rec.oils.map((o: any) => (
            <View style={styles.tr} key={o.id}>
              <Text style={[styles.cell, { width: "40%" }]}>{o.oilName}</Text>
              <Text style={[styles.cell, { width: "30%" }]}>{o.oilType || "—"}</Text>
              <Text style={[styles.cellR, { width: "15%" }]}>{o.quantity || "—"}</Text>
              <Text style={[styles.cellR, { width: "15%" }]}>{rs(o.priceCents)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Filters</Text>
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cell, { width: "40%" }]}>Filter</Text>
            <Text style={[styles.cell, { width: "30%" }]}>Part no.</Text>
            <Text style={[styles.cellR, { width: "15%" }]}>Qty</Text>
            <Text style={[styles.cellR, { width: "15%" }]}>Price</Text>
          </View>
          {rec.filters.length === 0 ? (
            <View style={styles.tr}><Text style={styles.cell}>None</Text></View>
          ) : rec.filters.map((f: any) => (
            <View style={styles.tr} key={f.id}>
              <Text style={[styles.cell, { width: "40%" }]}>{f.filterCategory}</Text>
              <Text style={[styles.cell, { width: "30%" }]}>{f.filterNo || "—"}</Text>
              <Text style={[styles.cellR, { width: "15%" }]}>{f.quantity}</Text>
              <Text style={[styles.cellR, { width: "15%" }]}>{rs(f.priceCents)}</Text>
            </View>
          ))}
        </View>

        {rec.costLines.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Other costs</Text>
            <View style={styles.table}>
              <View style={styles.th}>
                <Text style={[styles.cell, { width: "55%" }]}>Description</Text>
                <Text style={[styles.cellR, { width: "15%" }]}>Rate</Text>
                <Text style={[styles.cellR, { width: "15%" }]}>Qty</Text>
                <Text style={[styles.cellR, { width: "15%" }]}>Amount</Text>
              </View>
              {rec.costLines.map((c: any) => (
                <View style={styles.tr} key={c.id}>
                  <Text style={[styles.cell, { width: "55%" }]}>{c.description || "—"}</Text>
                  <Text style={[styles.cellR, { width: "15%" }]}>{rs(c.rateCents)}</Text>
                  <Text style={[styles.cellR, { width: "15%" }]}>{c.qty || "—"}</Text>
                  <Text style={[styles.cellR, { width: "15%" }]}>{rs(c.amountCents)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {rec.repairDetails ? (
          <>
            <Text style={styles.sectionTitle}>Repair details</Text>
            <Text style={{ fontSize: 8, color: "#444" }}>{rec.repairDetails}</Text>
          </>
        ) : null}

        <View style={styles.totals}>
          <View style={styles.totalRow}><Text>Parts subtotal</Text><Text>{rs(rec.partsSubtotalCents)}</Text></View>
          <View style={styles.totalRow}><Text>Labour ({rec.labourRatePct}%)</Text><Text>{rs(rec.labourChargeCents)}</Text></View>
          <View style={styles.totalRow}><Text>Sundry ({rec.sundryRatePct}%)</Text><Text>{rs(rec.sundryAmountCents)}</Text></View>
          <View style={styles.grand}><Text style={{ fontWeight: "bold" }}>Grand total</Text><Text style={{ fontWeight: "bold" }}>{rs(rec.grandTotalCents || rec.costCents)}</Text></View>
        </View>

        <Text style={styles.footer}>Recorded by {rec.recordedBy?.name || "—"} · Generated {new Date().toLocaleString("en-GB")} · E&C Fleet Service System</Text>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id },
    include: {
      asset: { select: { code: true, regNo: true, brand: true, model: true, projectId: true } },
      recordedBy: { select: { name: true } },
      oils: true,
      filters: true,
      costLines: true,
    },
  });
  if (!rec) return new NextResponse("Not found", { status: 404 });
  if (session.role === "USER" && session.projectId && rec.asset.projectId !== session.projectId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const stream = await renderToStream(<ServiceSheet rec={rec} />);
    const filename = `service_${rec.asset.code}_${new Date(rec.serviceDate).toISOString().slice(0, 10)}.pdf`;
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `inline; filename="${filename}"`);
    return response;
  } catch (err: any) {
    console.error("Service sheet PDF error:", err);
    return new NextResponse("Failed to generate the service sheet.", { status: 500 });
  }
}
