import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY, EcLogo } from "./invoice-document";
import type { SiteStatement, StatementTotals } from "./statement";

// The consolidated "by site" billing document, shared by the API route
// (src/app/api/billing/consolidated/pdf) and the offline PDF exporter script so
// both render the exact same layout. Callers fetch the bills + build the
// statement of account, then render this component with renderToStream (route)
// or renderToBuffer (script).

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

  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 7, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  docTitle: { fontSize: 19, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  docSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 4 },
  accentStrip: { backgroundColor: AMBER, height: 3 },

  infoBar: { backgroundColor: PANEL, padding: "9 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: MUTE, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 9, color: NAVY_SOFT, fontFamily: "Helvetica-Bold" },

  body: { padding: "14 32" },

  summaryRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: PANEL, borderRadius: 6, padding: "9 11", borderWidth: 1, borderColor: LINE },
  summaryCardHot: { flex: 1, backgroundColor: NAVY, borderRadius: 6, padding: "9 11" },
  summaryLabel: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: MUTE, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  summaryLabelHot: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#93c5fd", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  summaryVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  summaryValHot: { fontSize: 12, fontFamily: "Helvetica-Bold", color: AMBER },
  summarySub: { fontSize: 6.5, color: MUTE, marginTop: 2 },

  chipRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  chip: { backgroundColor: PANEL, borderRadius: 5, padding: "4 9", borderWidth: 1, borderColor: LINE, flexDirection: "row", alignItems: "center", gap: 5 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: SLATE },

  siteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: NAVY_SOFT, borderRadius: 5, padding: "7 12", marginTop: 14, marginBottom: 6 },
  siteName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: WHITE },
  siteMeta: { fontSize: 7.5, color: "#93c5fd", fontFamily: "Helvetica-Bold" },

  table: { width: "100%" },
  tHead: { flexDirection: "row", backgroundColor: PANEL2, borderTopWidth: 1.5, borderTopColor: NAVY_SOFT, borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 6.4, fontFamily: "Helvetica-Bold", color: NAVY_SOFT, textTransform: "uppercase", letterSpacing: 0.3 },
  tRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: 4.5, paddingHorizontal: 6, alignItems: "center" },
  tRowAlt: { backgroundColor: PANEL },

  // Widths total 100. Reg No and Rate were added at the owner's request: a site
  // clerk reconciles against the plate painted on the machine, not the E&C code,
  // and a client asked which rate a line was charged at.
  // Twelve columns on A4 portrait. The money columns keep the widths they had —
  // "1,385,290.00" needs every point of them — and the two new ones are paid for
  // by the make-and-model column that came out.
  cCode:    { width: "9%", flexDirection: "row", alignItems: "center", gap: 3 },
  cReg:     { width: "9%" },
  cDays:    { width: "5%", textAlign: "right" },
  cMode:    { width: "7%" },
  cFuelL:   { width: "7%", textAlign: "right" },
  cConsTyp: { width: "9%", textAlign: "right" },
  cActual:  { width: "8%", textAlign: "right" },
  cBill:    { width: "8%", textAlign: "right" },
  cRate:    { width: "8%", textAlign: "right" },
  cRental:  { width: "10%", textAlign: "right" },
  cFuelRs:  { width: "9%", textAlign: "right" },
  cGrand:   { width: "11%", textAlign: "right" },

  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  tCell: { fontSize: 7, color: SLATE },
  tCellCode: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  tCellNum: { fontSize: 7, color: INK, fontFamily: "Helvetica" },
  tCellGrand: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  tCellMute: { fontSize: 7, color: "#94a3b8" },
  billStrong: { fontSize: 7, fontFamily: "Helvetica-Bold", color: NAVY_SOFT },
  unitTag: { fontSize: 5.6, color: MUTE },
  fuelFlag: { color: AMBER_DEEP, fontFamily: "Helvetica-Bold" },

  siteSub: { flexDirection: "row", borderTopWidth: 1.25, borderTopColor: NAVY_SOFT, paddingVertical: 5, paddingHorizontal: 6, backgroundColor: PANEL, borderBottomLeftRadius: 5, borderBottomRightRadius: 5 },
  // Spans E&C No + Reg No + Days + Mode, so the subtotal's figures sit under
  // their own columns. Keep in step with those four widths.
  siteSubLabelCell: { width: "30%", flexDirection: "row", alignItems: "center", gap: 4 },
  siteSubLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTE, textTransform: "uppercase", letterSpacing: 0.3 },

  totalsOuter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: "46%", borderWidth: 1, borderColor: LINE, borderRadius: 6, overflow: "hidden" },
  totRow: { flexDirection: "row", justifyContent: "space-between", padding: "5 11", borderBottomWidth: 1, borderBottomColor: LINE },
  totLabel: { fontSize: 8, color: SLATE },
  totVal: { fontSize: 8, color: INK, fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "8 11" },
  grandLabel: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: WHITE },
  grandVal: { fontSize: 10, fontFamily: "Helvetica-Bold", color: AMBER },

  note: { fontSize: 6.6, color: MUTE, marginTop: 8, lineHeight: 1.4 },

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

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function rsWhole(cents: number) {
  return "Rs. " + Math.round(cents / 100).toLocaleString("en-LK");
}
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

function isFuelOnly(b: any) {
  return b.rentalAmountCents === 0 && b.fuelCostCents > 0;
}

// `statements` and `stmtTotals` are still accepted so every existing caller keeps
// compiling, but the Statement of Account section and the explanatory footnotes
// were removed from this document at the owner's request — the consolidated bill
// is what goes to a client, and the receivables position is his business, not
// theirs. The statement is still produced in the XLSX export.
export function ConsolidatedDocument({ bills, periodKey, generatedAt }: { bills: any[]; periodKey: string; generatedAt: string; statements?: SiteStatement[]; stmtTotals?: StatementTotals }) {
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

  // A split vehicle contributes one row per site; count the machines behind them.
  const vehicleCount = new Set(bills.map((b) => b.sourceBillId ?? b.id)).size;

  const total = sumBills(bills);
  const totalLitres = total.litres;
  const statusCounts = bills.reduce((acc: Record<string, number>, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
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
            {/* Machines, not rows: one that moved between sites is listed under
                each site it worked, so the row count overstates the fleet. */}
            <Text style={styles.infoVal}>{vehicleCount}</Text>
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

          <View style={styles.chipRow}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <View key={status} style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: STATUS_COLORS[status] || MUTE }]} />
                <Text style={styles.chipText}>{count as number} {status}</Text>
              </View>
            ))}
          </View>

          {siteGroups.map((group) => {
            const st = sumBills(group.bills);
            // Allow a large site (more rows than fit a page) to flow across pages;
            // individual rows never split (wrap={false} on each row below).
            return (
              <View key={group.name}>
                <View style={styles.siteHeader} wrap={false}>
                  <Text style={styles.siteName}>{group.name}</Text>
                  <Text style={styles.siteMeta}>{group.bills.length} vehicle(s) · {num(st.litres, 0)} L · {rs(st.grand)}</Text>
                </View>

                <View style={styles.table}>
                  <View style={styles.tHead}>
                    <Text style={[styles.tHeadCell, styles.cCode]}>E&C No</Text>
                    <Text style={[styles.tHeadCell, styles.cReg]}>Reg No</Text>
                    <Text style={[styles.tHeadCell, styles.cDays]}>Days</Text>
                    <Text style={[styles.tHeadCell, styles.cMode]}>Mode</Text>
                    <Text style={[styles.tHeadCell, styles.cFuelL]}>Fuel (L)</Text>
                    {/* Stacked rather than wrapped: left to itself "(cons typ)"
                        breaks as "(cons  typ)" and "(meter)" hyphenates. */}
                    <View style={styles.cConsTyp}>
                      <Text style={styles.tHeadCell}>Actual</Text>
                      <Text style={styles.tHeadCell}>(cons typ)</Text>
                    </View>
                    <View style={styles.cActual}>
                      <Text style={styles.tHeadCell}>Actual</Text>
                      <Text style={styles.tHeadCell}>(meter)</Text>
                    </View>
                    <Text style={[styles.tHeadCell, styles.cBill]}>Billed</Text>
                    <Text style={[styles.tHeadCell, styles.cRate]}>Rate</Text>
                    <Text style={[styles.tHeadCell, styles.cRental]}>Rental (Rs)</Text>
                    <Text style={[styles.tHeadCell, styles.cFuelRs]}>Fuel (Rs)</Text>
                    <Text style={[styles.tHeadCell, styles.cGrand]}>Grand (Rs)</Text>
                  </View>

                  {group.bills.map((b, i) => {
                    const fo = isFuelOnly(b);
                    const unit = unitFor(b.billingMode);
                    // Null, not zero, when there is no per-site meter figure: a
                    // vehicle split across sites has one reading for the month
                    // and no honest way to divide it. Printing 0 next to a real
                    // cons-typ figure would read as "the meter says it did
                    // nothing", which is a different claim entirely.
                    const actual = b.actualMeterUnits ?? b.actualUnits ?? null;
                    const basis = (b.rateBasis || "").toUpperCase();
                    // Days posted to this site, summed from the rental lines by
                    // the site split — so a shared vehicle shows the days this
                    // site had it, not the days of the whole month.
                    const days = b.assignedDays ?? 0;
                    const consTyp = b.derivedStandardUnits ?? null;
                    return (
                      <View key={b.id} style={[styles.tRow, i % 2 === 1 ? styles.tRowAlt : {}]} wrap={false}>
                        <View style={styles.cCode}>
                          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[b.status] || MUTE }]} />
                          <Text style={styles.tCellCode}>{b.assetCode}</Text>
                        </View>
                        {/* Shown even when it equals the E&C code: for 218 machines
                            the code IS the plate (LO-7855, 57-3062, PD-7049), so
                            blanking it would tell the reader the plate is unknown
                            when it is right there. Under a labelled column the
                            repetition is informative; only inline does it read wrong. */}
                        <View style={styles.cReg}>
                          <Text style={styles.tCell}>{b.assetRegNo || "—"}</Text>
                          {/* The make and model column is gone, so the driver
                              rides here rather than off the page. */}
                          {b.driverName ? <Text style={styles.tCellMute}>{b.driverName}</Text> : null}
                        </View>
                        <Text style={[styles.tCellNum, styles.cDays]}>{days > 0 ? num(days, 0) : "—"}</Text>
                        <Text style={[styles.tCell, styles.cMode]}>{fo ? "Fuel only" : `${modeShort(b.billingMode)} · ${basis}`}</Text>
                        <Text style={[styles.tCellNum, styles.cFuelL]}>{b.fuelLitres > 0 ? num(b.fuelLitres, 0) : "—"}</Text>
                        {/* What the diesel says the machine did, at its typical
                            consumption rate — the second opinion on the meter,
                            and the only one available when nobody read it. */}
                        <Text style={[fo || consTyp == null ? styles.tCellMute : styles.tCellNum, styles.cConsTyp]}>
                          {fo || consTyp == null ? "—" : <>{num(consTyp, 0)}<Text style={styles.unitTag}> {unit}</Text></>}
                        </Text>
                        <Text style={[fo || actual == null ? styles.tCellMute : styles.tCellNum, styles.cActual]}>
                          {fo || actual == null ? "—" : <>{num(actual, 0)}<Text style={styles.unitTag}> {unit}</Text></>}
                        </Text>
                        <Text style={styles.cBill}>
                          {fo ? <Text style={styles.tCellMute}>—</Text> : <><Text style={styles.billStrong}>{num(b.billableUnits, 0)}</Text><Text style={styles.unitTag}> {unit}</Text></>}
                        </Text>
                        <Text style={[fo ? styles.tCellMute : styles.tCellNum, styles.cRate]}>
                          {fo || !b.rateCents ? "—" : m(b.rateCents)}
                        </Text>
                        <Text style={[fo ? styles.tCellMute : styles.tCellNum, styles.cRental]}>{fo ? "—" : m(b.rentalAmountCents)}</Text>
                        <Text style={[b.fuelCostCents > 0 ? styles.tCellNum : styles.tCellMute, styles.cFuelRs]}>{b.fuelCostCents > 0 ? m(b.fuelCostCents) : "—"}</Text>
                        <Text style={[styles.tCellGrand, styles.cGrand]}>{m(b.grandTotalCents)}</Text>
                      </View>
                    );
                  })}

                  <View style={styles.siteSub}>
                    <View style={styles.siteSubLabelCell}>
                      <Text style={styles.siteSubLabel}>Site subtotal · {group.bills.length} veh.</Text>
                    </View>
                    <Text style={[styles.tCellNum, styles.cFuelL]}>{num(st.litres, 0)}</Text>
                    <Text style={[styles.tCellMute, styles.cConsTyp]}></Text>
                    <Text style={[styles.tCellMute, styles.cActual]}></Text>
                    <Text style={[styles.tCellMute, styles.cBill]}></Text>
                    <Text style={[styles.tCellMute, styles.cRate]}></Text>
                    <Text style={[styles.tCellGrand, styles.cRental]}>{m(st.rental)}</Text>
                    <Text style={[styles.tCellGrand, styles.cFuelRs]}>{m(st.fuel)}</Text>
                    <Text style={[styles.tCellGrand, styles.cGrand, { color: AMBER_DEEP }]}>{m(st.grand)}</Text>
                  </View>
                </View>
              </View>
            );
          })}

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

        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{COMPANY.name} · Consolidated billing</Text>
          <Text style={styles.footerSub} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
