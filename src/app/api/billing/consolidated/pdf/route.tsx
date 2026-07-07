import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";
import { COMPANY, EcLogo } from "@/lib/billing/invoice-document";
import { buildSiteStatements, totalStatement, type SiteStatement, type StatementTotals } from "@/lib/billing/statement";

// Brand + neutral palette. Kept deliberately small so the report reads as one
// system in both the summary band and the dense per-vehicle table.
const NAVY = "#132a43";
const NAVY_SOFT = "#1e3a5f";
const AMBER = "#f59e0b";
const AMBER_DEEP = "#b45309";
const INK = "#0f172a";
const SLATE = "#475569";
const MUTE = "#64748b";
const LINE = "#e2e8f0";
const PANEL = "#f8fafc";
const PANEL2 = "#f1f5f9";
const WHITE = "#ffffff";
const GREEN = "#047857";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: INK, backgroundColor: WHITE },

  // Letterhead — shared with the tax invoice
  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 7, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  docTitle: { fontSize: 19, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  docSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 4 },
  accentStrip: { backgroundColor: AMBER, height: 3 },

  // Meta strip under the letterhead
  infoBar: { backgroundColor: PANEL, padding: "9 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: MUTE, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 9, color: NAVY_SOFT, fontFamily: "Helvetica-Bold" },

  body: { padding: "14 32" },

  // KPI cards
  summaryRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: PANEL, borderRadius: 6, padding: "9 11", borderWidth: 1, borderColor: LINE },
  summaryCardHot: { flex: 1, backgroundColor: NAVY, borderRadius: 6, padding: "9 11" },
  summaryLabel: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: MUTE, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  summaryLabelHot: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#93c5fd", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  summaryVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  summaryValHot: { fontSize: 12, fontFamily: "Helvetica-Bold", color: AMBER },
  summarySub: { fontSize: 6.5, color: MUTE, marginTop: 2 },

  // Status chips
  chipRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  chip: { backgroundColor: PANEL, borderRadius: 5, padding: "4 9", borderWidth: 1, borderColor: LINE, flexDirection: "row", alignItems: "center", gap: 5 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: SLATE },

  // Site section
  siteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: NAVY_SOFT, borderRadius: 5, padding: "7 12", marginTop: 14, marginBottom: 6 },
  siteName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: WHITE },
  siteMeta: { fontSize: 7.5, color: "#93c5fd", fontFamily: "Helvetica-Bold" },

  // Vehicle table
  table: { width: "100%" },
  tHead: { flexDirection: "row", backgroundColor: PANEL2, borderTopWidth: 1.5, borderTopColor: NAVY_SOFT, borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 6.4, fontFamily: "Helvetica-Bold", color: NAVY_SOFT, textTransform: "uppercase", letterSpacing: 0.3 },
  tRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: 4.5, paddingHorizontal: 6, alignItems: "center" },
  tRowAlt: { backgroundColor: PANEL },

  cCode:   { width: "9%", flexDirection: "row", alignItems: "center", gap: 3 },
  cLabel:  { width: "16%" },
  cMode:   { width: "9%" },
  cFuelL:  { width: "9%", textAlign: "right" },
  cActual: { width: "10%", textAlign: "right" },
  cBill:   { width: "10%", textAlign: "right" },
  cRental: { width: "12%", textAlign: "right" },
  cFuelRs: { width: "11%", textAlign: "right" },
  cGrand:  { width: "14%", textAlign: "right" },

  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  tCell: { fontSize: 7, color: SLATE },
  tCellCode: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  tCellNum: { fontSize: 7, color: INK, fontFamily: "Helvetica" },
  tCellGrand: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  tCellMute: { fontSize: 7, color: "#94a3b8" },
  billStrong: { fontSize: 7, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  unitTag: { fontSize: 5.6, color: MUTE },
  fuelFlag: { color: AMBER_DEEP, fontFamily: "Helvetica-Bold" },

  // Per-site subtotal strip
  siteSub: { flexDirection: "row", borderTopWidth: 1.25, borderTopColor: NAVY_SOFT, paddingVertical: 5, paddingHorizontal: 6, backgroundColor: PANEL, borderBottomLeftRadius: 5, borderBottomRightRadius: 5 },
  siteSubLabelCell: { width: "34%", flexDirection: "row", alignItems: "center", gap: 4 },
  siteSubLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTE, textTransform: "uppercase", letterSpacing: 0.3 },

  // Grand totals box
  totalsOuter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: "46%", borderWidth: 1, borderColor: LINE, borderRadius: 6, overflow: "hidden" },
  totRow: { flexDirection: "row", justifyContent: "space-between", padding: "5 11", borderBottomWidth: 1, borderBottomColor: LINE },
  totLabel: { fontSize: 8, color: SLATE },
  totVal: { fontSize: 8, color: INK, fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "8 11" },
  grandLabel: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: WHITE },
  grandVal: { fontSize: 10, fontFamily: "Helvetica-Bold", color: AMBER },

  // Legend / note
  note: { fontSize: 6.6, color: MUTE, marginTop: 8, lineHeight: 1.4 },

  // Statement of account
  stmtHeading: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY_SOFT, marginTop: 20, marginBottom: 5, borderTopWidth: 2, borderTopColor: NAVY_SOFT, paddingTop: 10 },
  stmtSub: { fontSize: 7.5, color: MUTE, marginTop: -2, marginBottom: 6 },
  stmtHead: { flexDirection: "row", backgroundColor: NAVY_SOFT, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  stmtHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  stmtRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 6 },
  stmtTotRow: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 6, paddingHorizontal: 6, marginTop: 3 },
  sSite: { width: "28%" },
  sNum:  { width: "18%", textAlign: "right" },
  stmtCell: { fontSize: 7.5, color: SLATE },
  stmtCellBold: { fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  stmtTotCell: { fontSize: 8, fontFamily: "Helvetica-Bold", color: WHITE },

  footer: { backgroundColor: AMBER, padding: "6 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: "auto" },
  footerText: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  footerSub: { fontSize: 7, color: "#78350f" },
});

// Money with the Rs. prefix (summary + totals).
function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Whole-rupee money for the KPI cards, so long totals don't wrap.
function rsWhole(cents: number) {
  return "Rs. " + Math.round(cents / 100).toLocaleString("en-LK");
}
// Compact money for dense table cells (no prefix; the column header carries "Rs").
function m(cents: number) {
  return (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(x: number, digits = 0) {
  return x.toLocaleString("en-LK", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function unitFor(mode: string) {
  return mode === "perkm" ? "km" : mode === "perday" ? "day" : "hr";
}
function modeShort(mode: string) {
  return mode === "perkm" ? "Per-KM" : mode === "perday" ? "Per-Day" : "Hourly";
}

const STATUS_COLORS: Record<string, string> = {
  PAID: GREEN,
  ISSUED: "#1d4ed8",
  DRAFT: AMBER_DEEP,
  OVERDUE: "#b91c1c",
};

function sumBills(list: any[]) {
  return list.reduce(
    (a, b) => {
      a.rental += b.rentalAmountCents;
      a.fuel += b.fuelCostCents;
      a.litres += b.fuelLitres || 0;
      a.sscl += b.ssclCents;
      a.vat += b.vatCents;
      a.grand += b.grandTotalCents;
      return a;
    },
    { rental: 0, fuel: 0, litres: 0, sscl: 0, vat: 0, grand: 0 }
  );
}

// A privately-owned vehicle E&C fuels but does not rent bills fuel only: zero
// rental with fuel charged. Its usage columns read "—".
function isFuelOnly(b: any) {
  return b.rentalAmountCents === 0 && b.fuelCostCents > 0;
}

function ConsolidatedDocument({ bills, periodKey, generatedAt, statements, stmtTotals }: { bills: any[]; periodKey: string; generatedAt: string; statements: SiteStatement[]; stmtTotals: StatementTotals }) {
  const monthLabel = (() => {
    const [y, mo] = periodKey.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  })();

  const groups = new Map<string, { name: string; bills: any[] }>();
  for (const b of bills) {
    const key = b.projectId || "__unassigned__";
    if (!groups.has(key)) groups.set(key, { name: b.projectName || "Unassigned", bills: [] });
    groups.get(key)!.bills.push(b);
  }
  const siteGroups = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

  const total = sumBills(bills);
  const totalLitres = total.litres;
  const statusCounts = bills.reduce((acc: Record<string, number>, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Letterhead */}
        <View style={styles.headerBand} fixed>
          <View style={styles.logoBox}>
            <View style={styles.logoMark}><EcLogo size={34} /></View>
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

        {/* Meta strip */}
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
            <Text style={styles.infoLabel}>Vehicles</Text>
            <Text style={styles.infoVal}>{bills.length}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Fuel Issued</Text>
            <Text style={styles.infoVal}>{num(totalLitres, 0)} L</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Grand Total</Text>
            <Text style={[styles.infoVal, { color: AMBER_DEEP }]}>{rs(total.grand)}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* KPI cards */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Rental</Text>
              <Text style={styles.summaryVal}>{rsWhole(total.rental)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Fuel</Text>
              <Text style={styles.summaryVal}>{rsWhole(total.fuel)}</Text>
              <Text style={styles.summarySub}>{num(totalLitres, 0)} litres issued</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>SSCL 2.5%</Text>
              <Text style={styles.summaryVal}>{rsWhole(total.sscl)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>VAT 18%</Text>
              <Text style={styles.summaryVal}>{rsWhole(total.vat)}</Text>
            </View>
            <View style={styles.summaryCardHot}>
              <Text style={styles.summaryLabelHot}>Grand Total</Text>
              <Text style={styles.summaryValHot}>{rsWhole(total.grand)}</Text>
            </View>
          </View>

          {/* Status chips */}
          <View style={styles.chipRow}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <View key={status} style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: STATUS_COLORS[status] || MUTE }]} />
                <Text style={styles.chipText}>{count as number} {status}</Text>
              </View>
            ))}
          </View>

          {/* Per-site sections */}
          {siteGroups.map((group) => {
            const st = sumBills(group.bills);
            return (
              <View key={group.name} wrap={false}>
                <View style={styles.siteHeader}>
                  <Text style={styles.siteName}>{group.name}</Text>
                  <Text style={styles.siteMeta}>{group.bills.length} vehicle(s) · {num(st.litres, 0)} L · {rs(st.grand)}</Text>
                </View>

                <View style={styles.table}>
                  <View style={styles.tHead}>
                    <Text style={[styles.tHeadCell, styles.cCode]}>E&C No</Text>
                    <Text style={[styles.tHeadCell, styles.cLabel]}>Vehicle</Text>
                    <Text style={[styles.tHeadCell, styles.cMode]}>Mode</Text>
                    <Text style={[styles.tHeadCell, styles.cFuelL]}>Fuel (L)</Text>
                    <Text style={[styles.tHeadCell, styles.cActual]}>Actual</Text>
                    <Text style={[styles.tHeadCell, styles.cBill]}>Billed</Text>
                    <Text style={[styles.tHeadCell, styles.cRental]}>Rental (Rs)</Text>
                    <Text style={[styles.tHeadCell, styles.cFuelRs]}>Fuel (Rs)</Text>
                    <Text style={[styles.tHeadCell, styles.cGrand]}>Grand (Rs)</Text>
                  </View>

                  {group.bills.map((b, i) => {
                    const fo = isFuelOnly(b);
                    const unit = unitFor(b.billingMode);
                    const actual = b.actualMeterUnits ?? b.actualUnits ?? 0;
                    const basis = (b.rateBasis || "").toUpperCase();
                    return (
                      <View key={b.id} style={[styles.tRow, i % 2 === 1 ? styles.tRowAlt : {}]}>
                        <View style={styles.cCode}>
                          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[b.status] || MUTE }]} />
                          <Text style={styles.tCellCode}>{b.assetCode}</Text>
                        </View>
                        <Text style={[styles.tCell, styles.cLabel]}>{b.assetLabel || "—"}</Text>
                        <Text style={[styles.tCell, styles.cMode]}>{fo ? "Fuel only" : `${modeShort(b.billingMode)} · ${basis}`}</Text>
                        <Text style={[styles.tCellNum, styles.cFuelL]}>{b.fuelLitres > 0 ? num(b.fuelLitres, 0) : "—"}</Text>
                        <Text style={[fo ? styles.tCellMute : styles.tCellNum, styles.cActual]}>
                          {fo ? "—" : <>{num(actual, 0)}<Text style={styles.unitTag}> {unit}</Text></>}
                        </Text>
                        <Text style={styles.cBill}>
                          {fo ? <Text style={styles.tCellMute}>—</Text> : <><Text style={styles.billStrong}>{num(b.billableUnits, 0)}</Text><Text style={styles.unitTag}> {unit}</Text></>}
                        </Text>
                        <Text style={[fo ? styles.tCellMute : styles.tCellNum, styles.cRental]}>{fo ? "—" : m(b.rentalAmountCents)}</Text>
                        <Text style={[b.fuelCostCents > 0 ? styles.tCellNum : styles.tCellMute, styles.cFuelRs]}>{b.fuelCostCents > 0 ? m(b.fuelCostCents) : "—"}</Text>
                        <Text style={[styles.tCellGrand, styles.cGrand]}>{m(b.grandTotalCents)}</Text>
                      </View>
                    );
                  })}

                  {/* Per-site subtotal */}
                  <View style={styles.siteSub}>
                    <View style={styles.siteSubLabelCell}>
                      <Text style={styles.siteSubLabel}>Site subtotal · {group.bills.length} veh.</Text>
                    </View>
                    <Text style={[styles.tCellNum, styles.cFuelL]}>{num(st.litres, 0)}</Text>
                    <Text style={[styles.tCellMute, styles.cActual]}></Text>
                    <Text style={[styles.tCellMute, styles.cBill]}></Text>
                    <Text style={[styles.tCellGrand, styles.cRental]}>{m(st.rental)}</Text>
                    <Text style={[styles.tCellGrand, styles.cFuelRs]}>{m(st.fuel)}</Text>
                    <Text style={[styles.tCellGrand, styles.cGrand, { color: AMBER_DEEP }]}>{m(st.grand)}</Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Grand totals */}
          <View style={styles.totalsOuter}>
            <View style={styles.totalsBox}>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total Rental</Text>
                <Text style={styles.totVal}>{rs(total.rental)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Total Fuel ({num(totalLitres, 0)} L)</Text>
                <Text style={styles.totVal}>{rs(total.fuel)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>SSCL @ 2.5%</Text>
                <Text style={styles.totVal}>{rs(total.sscl)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>VAT @ 18%</Text>
                <Text style={styles.totVal}>{rs(total.vat)}</Text>
              </View>
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandVal}>{rs(total.grand)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.note}>
            Fuel (L) = fuel issued for the month. Actual = recorded meter movement (hrs/km). Billed = units actually charged — the greater of
            the recorded/fuel-derived usage and the availability-prorated guaranteed minimum. A 0 actual with a billed figure means the vehicle
            had no meter reading and was billed the minimum. Fuel-only rows are privately-owned vehicles E&amp;C fuels but does not rent.
          </Text>

          {/* Statement of account */}
          {statements.length > 0 && (
            <View wrap={false}>
              <Text style={styles.stmtHeading}>Statement of Account</Text>
              <Text style={styles.stmtSub}>Invoiced this period, less issued credits and payments received, equals the amount outstanding.</Text>
              <View style={styles.stmtHead}>
                <Text style={[styles.stmtHeadCell, styles.sSite]}>Site</Text>
                <Text style={[styles.stmtHeadCell, styles.sNum]}>Invoiced</Text>
                <Text style={[styles.stmtHeadCell, styles.sNum]}>Credits</Text>
                <Text style={[styles.stmtHeadCell, styles.sNum]}>Paid</Text>
                <Text style={[styles.stmtHeadCell, styles.sNum]}>Outstanding</Text>
              </View>
              {statements.map((s, i) => (
                <View key={s.projectKey} style={[styles.stmtRow, i % 2 === 1 ? styles.tRowAlt : {}]}>
                  <Text style={[styles.stmtCell, styles.sSite, styles.stmtCellBold]}>{s.projectName}</Text>
                  <Text style={[styles.stmtCell, styles.sNum]}>{rs(s.invoicedCents)}</Text>
                  <Text style={[styles.stmtCell, styles.sNum]}>{s.creditedCents > 0 ? "−" + rs(s.creditedCents) : "—"}</Text>
                  <Text style={[styles.stmtCell, styles.sNum]}>{s.paidCents > 0 ? "−" + rs(s.paidCents) : "—"}</Text>
                  <Text style={[styles.stmtCell, styles.sNum, styles.stmtCellBold]}>{rs(s.outstandingCents)}</Text>
                </View>
              ))}
              <View style={styles.stmtTotRow}>
                <Text style={[styles.stmtTotCell, styles.sSite]}>ALL SITES</Text>
                <Text style={[styles.stmtTotCell, styles.sNum]}>{rs(stmtTotals.invoicedCents)}</Text>
                <Text style={[styles.stmtTotCell, styles.sNum]}>{stmtTotals.creditedCents > 0 ? "−" + rs(stmtTotals.creditedCents) : "—"}</Text>
                <Text style={[styles.stmtTotCell, styles.sNum]}>{stmtTotals.paidCents > 0 ? "−" + rs(stmtTotals.paidCents) : "—"}</Text>
                <Text style={[styles.stmtTotCell, styles.sNum, { color: AMBER }]}>{rs(stmtTotals.outstandingCents)}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{COMPANY.name} · Consolidated billing</Text>
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
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  // Statement of account: reconcile invoices with credit notes + payments.
  const billIds = bills.map((b) => b.id);
  const [creditRows, paymentRows] = await Promise.all([
    prisma.creditNote.findMany({ where: { billId: { in: billIds } } }),
    prisma.payment.findMany({ where: { billId: { in: billIds } } }),
  ]);
  const statements = buildSiteStatements(
    bills.map((b) => ({
      billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode,
      assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents,
    })),
    creditRows.map((c) => ({ billId: c.billId, number: c.number, reason: c.reason, amountCents: c.amountCents, status: c.status })),
    paymentRows.map((p) => ({ billId: p.billId, amountCents: p.amountCents, paidDate: p.paidDate, method: p.method, reference: p.reference })),
  );
  const stmtTotals = totalStatement(statements);

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fileSuffix = siteCode ? `${siteCode}_${periodKey}` : periodKey;

  try {
    const stream = await renderToStream(
      <ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />
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
