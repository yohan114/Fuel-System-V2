import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";
import { COMPANY, EcLogo } from "@/lib/billing/invoice-document";

const NAVY = "#1e3a5f";
const AMBER = "#f59e0b";
const LIGHT = "#f8fafc";
const WHITE = "#ffffff";
const GRAY = "#64748b";
const GRAY_LIGHT = "#e2e8f0";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },

  // Header — matches InvoiceDocument exactly
  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 6, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  docSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 4 },

  accentStrip: { backgroundColor: AMBER, height: 3 },

  // Info bar — matches invoice infoBar
  infoBar: { backgroundColor: LIGHT, padding: "10 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },

  body: { padding: "14 32" },

  // Summary cards
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  summaryCard: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "8 10", borderWidth: 1, borderColor: GRAY_LIGHT },
  summaryLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  summaryVal: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },

  secHeading: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, marginTop: 12 },

  // Vehicle table
  table: { width: "100%", marginTop: 4 },
  tHead: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingVertical: 5, paddingHorizontal: 6 },
  tRowAlt: { backgroundColor: LIGHT },
  cCode:   { width: "12%" },
  cLabel:  { width: "22%" },
  cSite:   { width: "18%" },
  cMode:   { width: "12%" },
  cRental: { width: "12%", textAlign: "right" },
  cFuel:   { width: "12%", textAlign: "right" },
  cGrand:  { width: "12%", textAlign: "right" },
  tCell: { fontSize: 7.5, color: "#334155" },
  tCellBold: { fontFamily: "Helvetica-Bold", color: NAVY },

  // Totals — matches invoice totalsBox
  totalsOuter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: "44%", borderWidth: 1, borderColor: GRAY_LIGHT, borderRadius: 4, overflow: "hidden" },
  totRow: { flexDirection: "row", justifyContent: "space-between", padding: "5 10", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  totLabel: { fontSize: 8, color: GRAY },
  totVal: { fontSize: 8, color: "#334155", fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "7 10" },
  grandLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: WHITE },
  grandVal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: AMBER },

  footer: { backgroundColor: AMBER, padding: "6 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: "auto" },
  footerText: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  footerSub: { fontSize: 7, color: "#78350f" },

  // Site section
  siteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: NAVY, borderRadius: 4, padding: "7 12", marginTop: 16, marginBottom: 6 },
  siteName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE },
  siteMeta: { fontSize: 7.5, color: "#93c5fd" },
  siteSubtotalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, backgroundColor: LIGHT, borderRadius: 3, padding: "5 12", marginTop: 4, borderWidth: 1, borderColor: GRAY_LIGHT },
  siteSubLabel: { fontSize: 7.5, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  siteSubVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },
});

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLORS: Record<string, string> = {
  PAID: "#065f46",
  ISSUED: "#1e40af",
  DRAFT: "#92400e",
  OVERDUE: "#991b1b",
};

function sumBills(list: any[]) {
  return list.reduce(
    (a, b) => {
      a.rental += b.rentalAmountCents;
      a.fuel += b.fuelCostCents;
      a.sscl += b.ssclCents;
      a.vat += b.vatCents;
      a.grand += b.grandTotalCents;
      return a;
    },
    { rental: 0, fuel: 0, sscl: 0, vat: 0, grand: 0 }
  );
}

function ConsolidatedDocument({ bills, periodKey, generatedAt }: { bills: any[]; periodKey: string; generatedAt: string }) {
  const monthLabel = (() => {
    const [y, m] = periodKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  })();

  // Group bills by site (project)
  const groups = new Map<string, { name: string; bills: any[] }>();
  for (const b of bills) {
    const key = b.projectId || "__unassigned__";
    if (!groups.has(key)) groups.set(key, { name: b.projectName || "Unassigned", bills: [] });
    groups.get(key)!.bills.push(b);
  }
  const siteGroups = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

  const total = sumBills(bills);
  const statusCounts = bills.reduce((acc: Record<string, number>, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Header band — same layout as TAX INVOICE */}
        <View style={styles.headerBand} fixed>
          <View style={styles.logoBox}>
            <View style={styles.logoMark}>
              <EcLogo size={34} />
            </View>
            <View>
              <Text style={styles.companyName}>{COMPANY.name}</Text>
              <Text style={styles.companyDiv}>{COMPANY.division}</Text>
              <Text style={styles.companyDoc}>Doc No: {COMPANY.docNumber}</Text>
            </View>
          </View>
          <View>
            <Text style={styles.docTitle}>CONSOLIDATED BILLING</Text>
            <Text style={styles.docSub}>By Site · {monthLabel}</Text>
            <Text style={styles.docSub}>Generated: {generatedAt}</Text>
          </View>
        </View>
        <View style={styles.accentStrip} fixed />

        {/* Info bar — mirrors invoice infoBar */}
        <View style={styles.infoBar} fixed>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Period</Text>
            <Text style={styles.infoVal}>{monthLabel}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Sites</Text>
            <Text style={styles.infoVal}>{siteGroups.length}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Total Vehicles</Text>
            <Text style={styles.infoVal}>{bills.length}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Grand Total</Text>
            <Text style={[styles.infoVal, { color: AMBER }]}>{rs(total.grand)}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Summary cards */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Rental</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(total.rental)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Fuel</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(total.fuel)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total SSCL</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(total.sscl)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total VAT</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(total.vat)}</Text>
            </View>
            <View style={[styles.summaryCard, { borderColor: NAVY, borderWidth: 1.5 }]}>
              <Text style={styles.summaryLabel}>Grand Total</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(total.grand)}</Text>
            </View>
          </View>

          {/* Status breakdown */}
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <View key={status} style={{ backgroundColor: LIGHT, borderRadius: 4, padding: "5 8", borderWidth: 1, borderColor: GRAY_LIGHT }}>
                <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: STATUS_COLORS[status] || GRAY }}>{status}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155" }}>{count as number}</Text>
              </View>
            ))}
          </View>

          {/* Per-site sections */}
          {siteGroups.map((group) => {
            const st = sumBills(group.bills);
            return (
              <View key={group.name}>
                <View style={styles.siteHeader}>
                  <Text style={styles.siteName}>{group.name}</Text>
                  <Text style={styles.siteMeta}>{group.bills.length} vehicle(s) · {rs(st.grand)}</Text>
                </View>
                <View style={styles.table}>
                  <View style={styles.tHead}>
                    <Text style={[styles.tHeadCell, styles.cCode]}>E&C No</Text>
                    <Text style={[styles.tHeadCell, styles.cLabel]}>Vehicle</Text>
                    <Text style={[styles.tHeadCell, styles.cSite]}>Status</Text>
                    <Text style={[styles.tHeadCell, styles.cMode]}>Mode/Basis</Text>
                    <Text style={[styles.tHeadCell, styles.cRental]}>Rental</Text>
                    <Text style={[styles.tHeadCell, styles.cFuel]}>Fuel</Text>
                    <Text style={[styles.tHeadCell, styles.cGrand]}>Grand Total</Text>
                  </View>
                  {group.bills.map((b, i) => (
                    <View key={b.id} style={[styles.tRow, i % 2 === 1 ? styles.tRowAlt : {}]}>
                      <Text style={[styles.tCell, styles.cCode, styles.tCellBold]}>{b.assetCode}</Text>
                      <Text style={[styles.tCell, styles.cLabel]}>{b.assetLabel || "—"}</Text>
                      <Text style={[styles.tCell, styles.cSite, { color: STATUS_COLORS[b.status] || GRAY }]}>{b.status}</Text>
                      <Text style={[styles.tCell, styles.cMode]}>{b.billingMode.toUpperCase()} · {b.rateBasis.toUpperCase()}</Text>
                      <Text style={[styles.tCell, styles.cRental]}>{rs(b.rentalAmountCents)}</Text>
                      <Text style={[styles.tCell, styles.cFuel]}>{b.fuelCostCents > 0 ? rs(b.fuelCostCents) : "—"}</Text>
                      <Text style={[styles.tCell, styles.cGrand, styles.tCellBold]}>{rs(b.grandTotalCents)}</Text>
                    </View>
                  ))}
                </View>
                {/* Per-site subtotal */}
                <View style={styles.siteSubtotalRow}>
                  <Text style={styles.siteSubLabel}>Rental <Text style={styles.siteSubVal}>{rs(st.rental)}</Text></Text>
                  <Text style={styles.siteSubLabel}>Fuel <Text style={styles.siteSubVal}>{rs(st.fuel)}</Text></Text>
                  <Text style={styles.siteSubLabel}>SSCL <Text style={styles.siteSubVal}>{rs(st.sscl)}</Text></Text>
                  <Text style={styles.siteSubLabel}>VAT <Text style={styles.siteSubVal}>{rs(st.vat)}</Text></Text>
                  <Text style={styles.siteSubLabel}>Site Total <Text style={[styles.siteSubVal, { color: AMBER }]}>{rs(st.grand)}</Text></Text>
                </View>
              </View>
            );
          })}

          {/* Grand totals — matches invoice totalsBox layout */}
          <View style={styles.totalsOuter}>
            <View style={styles.totalsBox}>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total Rental</Text>
                <Text style={styles.totVal}>{rs(total.rental)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total Fuel</Text>
                <Text style={styles.totVal}>{rs(total.fuel)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total SSCL</Text>
                <Text style={styles.totVal}>{rs(total.sscl)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total VAT</Text>
                <Text style={styles.totVal}>{rs(total.vat)}</Text>
              </View>
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandVal}>{rs(total.grand)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Footer — amber band like TAX INVOICE */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerSub} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || "", 10);
  const month = parseInt(searchParams.get("month") || "", 10);

  if (!year || !month || month < 1 || month > 12) {
    return new NextResponse("year and month query parameters are required", { status: 400 });
  }

  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const siteCode = searchParams.get("site")?.trim() || null; // optional: filter to one site (project code)

  const where: any = { year, month };
  if (siteCode) where.projectCode = siteCode;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: [{ projectName: "asc" }, { assetCode: "asc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fileSuffix = siteCode ? `${siteCode}_${periodKey}` : periodKey;

  try {
    const stream = await renderToStream(
      <ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} />
    );
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="consolidated_billing_${fileSuffix}.pdf"`);
    return response;
  } catch (err: any) {
    console.error("Consolidated PDF error:", err);
    return new NextResponse("Failed to compile consolidated PDF.", { status: 500 });
  }
}
