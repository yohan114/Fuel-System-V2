import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Path, Line } from "@react-pdf/renderer";
import { formatVariancePct } from "../reports/recommended";

const NAVY = "#1e3a5f";
const AMBER = "#f59e0b";
const LIGHT = "#f8fafc";
const WHITE = "#ffffff";
const GRAY = "#64748b";
const GRAY_LIGHT = "#e2e8f0";

export const COMPANY = {
  name: "Edward and Christie Group",
  division: "Heavy Equipment & Fleet Division",
  address: "64/09 Nawala Road, Nugegoda, Sri Lanka",
  phone: "0112812990, 0112812991, 0112812441",
  email: "edchrist@sltnet.lk",
  vatReg: "VAT Reg No: 174042756-7000",
  docNumber: "EC40.WS.IV.8.12.25.3",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },

  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 6, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  invoiceLabel: { fontSize: 20, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  invoiceNum: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE, textAlign: "right", marginTop: 4 },
  statusBadge: { fontSize: 7, color: "#93c5fd", textAlign: "right", marginTop: 2, textTransform: "uppercase" },

  accentStrip: { backgroundColor: AMBER, height: 3 },

  infoBar: { backgroundColor: LIGHT, padding: "10 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },

  body: { padding: "14 32" },

  partiesRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  partyBox: { flex: 1, borderWidth: 1, borderColor: GRAY_LIGHT, borderRadius: 4, padding: "8 10" },
  partyTitle: { fontSize: 7, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingBottom: 3 },
  partyLine: { fontSize: 8, color: "#334155", marginBottom: 2 },
  partyGray: { fontSize: 7.5, color: GRAY },

  secHeading: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, marginTop: 12 },

  usageGrid: { flexDirection: "row", gap: 6, marginBottom: 12 },
  usageCell: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "6 8", alignItems: "center" },
  usageCellLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  usageCellVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  usageCellUnit: { fontSize: 7, color: GRAY },

  table: { width: "100%", marginTop: 4 },
  tHead: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingVertical: 5, paddingHorizontal: 6 },
  tRowAlt: { backgroundColor: LIGHT },
  cKind: { width: "13%" },
  cDesc: { width: "41%" },
  cQty:  { width: "16%", textAlign: "right" },
  cRate: { width: "15%", textAlign: "right" },
  cAmt:  { width: "15%", textAlign: "right" },
  tCell: { fontSize: 8, color: "#334155" },
  tCellBold: { fontFamily: "Helvetica-Bold", color: NAVY },
  tCellFuel: { color: "#b45309" },
  tCellAdj: { color: "#b91c1c" },

  totalsOuter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
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
});

// E&C company logo (vector): black "e" ring + crossbar with an orange "c" nested inside.
// Rendered on a white tile so it stays visible on the navy header band.
export function EcLogo({ size = 34 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Black outer "e" — near-full ring, open on the right */}
      <Path d="M79.49 70.65 A36 36 0 1 1 79.49 29.35" stroke="#111111" strokeWidth={12} fill="none" strokeLinecap="round" />
      {/* "e" crossbar (tongue) into the opening */}
      <Line x1="49" y1="50" x2="82" y2="50" stroke="#111111" strokeWidth={12} strokeLinecap="round" />
      {/* Orange inner "c" — open on the right */}
      <Path d="M66.09 63.50 A21 21 0 1 1 66.09 36.50" stroke="#f5a01e" strokeWidth={11} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function d(date: Date | null | undefined) {
  return date ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function InvoiceDocument({ bill }: { bill: any }) {
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const isDraft = bill.status === "DRAFT";

  // Actual entered meter vs the system-recommended (fuel ÷ typical rate) units.
  const unit = bill.billingMode === "perkm" ? "km" : "hr";
  const isMetered = bill.billingMode === "hourly" || bill.billingMode === "perkm";
  const actualMeter: number = bill.actualMeterUnits ?? (bill.derivedFromFuel ? 0 : bill.actualUnits);
  const recommended: number | null = bill.derivedStandardUnits ?? null;
  const variancePct: number | null =
    isMetered && recommended != null ? ((recommended - actualMeter) / Math.max(actualMeter, 1)) * 100 : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
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
            <Text style={styles.invoiceLabel}>TAX INVOICE</Text>
            <Text style={styles.invoiceNum}>{bill.invoiceNumber || (isDraft ? "DRAFT" : "—")}</Text>
            <Text style={styles.statusBadge}>{bill.status} · {monthLabel}</Text>
          </View>
        </View>
        <View style={styles.accentStrip} />

        <View style={styles.infoBar}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Issued</Text>
            <Text style={styles.infoVal}>{d(bill.issuedDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Due Date</Text>
            <Text style={styles.infoVal}>{d(bill.dueDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Period</Text>
            <Text style={styles.infoVal}>{monthLabel}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Billing Mode</Text>
            <Text style={styles.infoVal}>{bill.billingMode.toUpperCase()} · {bill.rateBasis.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.partiesRow}>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>From (Supplier)</Text>
              <Text style={styles.partyLine}>{COMPANY.name}</Text>
              <Text style={styles.partyGray}>{COMPANY.address}</Text>
              <Text style={styles.partyGray}>{COMPANY.phone}</Text>
              <Text style={styles.partyGray}>{COMPANY.email}</Text>
              <Text style={styles.partyGray}>{COMPANY.vatReg}</Text>
            </View>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>Bill To (Site / Client)</Text>
              <Text style={styles.partyLine}>{bill.projectName || "Unassigned / Global Pool"}</Text>
              {bill.projectCode ? <Text style={styles.partyGray}>Project Code: {bill.projectCode}</Text> : null}
            </View>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>Machine Details</Text>
              <Text style={styles.partyLine}>E&C No: {bill.assetCode}</Text>
              <Text style={styles.partyGray}>Reg No: {bill.assetRegNo || "—"}</Text>
              <Text style={styles.partyGray}>{bill.assetLabel || "—"}</Text>
            </View>
          </View>

          <Text style={styles.secHeading}>Usage Summary</Text>
          <View style={styles.usageGrid}>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Actual</Text>
              <Text style={styles.usageCellVal}>{bill.actualUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Minimum</Text>
              <Text style={styles.usageCellVal}>{bill.minimumUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={[styles.usageCell, { backgroundColor: "#dbeafe" }]}>
              <Text style={styles.usageCellLabel}>Billable</Text>
              <Text style={[styles.usageCellVal, { color: NAVY }]}>{bill.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Fuel Issued</Text>
              <Text style={styles.usageCellVal}>{bill.fuelLitres.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>litres</Text>
            </View>
            {bill.openingMeter != null && (
              <View style={styles.usageCell}>
                <Text style={styles.usageCellLabel}>Meter</Text>
                <Text style={[styles.usageCellVal, { fontSize: 8 }]}>{bill.openingMeter.toLocaleString()} →</Text>
                <Text style={[styles.usageCellUnit, { fontSize: 8 }]}>{bill.closingMeter?.toLocaleString()}</Text>
              </View>
            )}
          </View>

          {isMetered && (
            <>
              <Text style={styles.secHeading}>Actual Meter vs System-Recommended</Text>
              <View style={styles.usageGrid}>
                <View style={styles.usageCell}>
                  <Text style={styles.usageCellLabel}>Actual Meter</Text>
                  <Text style={styles.usageCellVal}>{actualMeter.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
                  <Text style={styles.usageCellUnit}>{unit}</Text>
                </View>
                <View style={styles.usageCell}>
                  <Text style={styles.usageCellLabel}>Recommended (fuel)</Text>
                  <Text style={styles.usageCellVal}>{recommended != null ? recommended.toLocaleString("en-LK", { maximumFractionDigits: 1 }) : "—"}</Text>
                  <Text style={styles.usageCellUnit}>{bill.fuelConsTypSnapshot ? `${unit} @ ${bill.fuelConsTypSnapshot} L/${unit}` : unit}</Text>
                </View>
                <View style={styles.usageCell}>
                  <Text style={styles.usageCellLabel}>Variance</Text>
                  <Text style={[styles.usageCellVal, variancePct != null && Math.abs(variancePct) >= 20 ? { color: "#b91c1c" } : {}]}>
                    {variancePct != null ? formatVariancePct(variancePct / 100) : "—"}
                  </Text>
                  <Text style={styles.usageCellUnit}>{bill.derivedFromFuel ? "billed on fuel" : "billed on meter"}</Text>
                </View>
                <View style={styles.usageCell}>
                  <Text style={styles.usageCellLabel}>Rate / {unit}</Text>
                  <Text style={[styles.usageCellVal, { fontSize: 9 }]}>{rs(bill.rateCents)}</Text>
                  <Text style={styles.usageCellUnit}>{bill.rateBasis?.toUpperCase()}</Text>
                </View>
              </View>
            </>
          )}

          <Text style={styles.secHeading}>Charges</Text>
          <View style={styles.table}>
            <View style={styles.tHead}>
              <Text style={[styles.tHeadCell, styles.cKind]}>Type</Text>
              <Text style={[styles.tHeadCell, styles.cDesc]}>Description</Text>
              <Text style={[styles.tHeadCell, styles.cQty]}>Qty</Text>
              <Text style={[styles.tHeadCell, styles.cRate]}>Unit Rate</Text>
              <Text style={[styles.tHeadCell, styles.cAmt]}>Amount</Text>
            </View>
            {bill.lineItems.map((li: any, i: number) => {
              const isAlt = i % 2 === 1;
              const kindStyle = li.kind === "FUEL" ? styles.tCellFuel : li.kind === "ADJUSTMENT" ? styles.tCellAdj : styles.tCellBold;
              return (
                <View key={i} style={[styles.tRow, isAlt ? styles.tRowAlt : {}]}>
                  <Text style={[styles.tCell, styles.cKind, kindStyle]}>{li.kind}</Text>
                  <Text style={[styles.tCell, styles.cDesc]}>{li.description}</Text>
                  <Text style={[styles.tCell, styles.cQty]}>{li.quantity.toLocaleString("en-LK", { maximumFractionDigits: 2 })} {li.unit}</Text>
                  <Text style={[styles.tCell, styles.cRate]}>{rs(li.unitRateCents)}</Text>
                  <Text style={[styles.tCell, styles.cAmt, kindStyle]}>{rs(li.amountCents)}</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.totalsOuter}>
            <View style={styles.totalsBox}>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Subtotal</Text>
                <Text style={styles.totVal}>{rs(bill.subtotalCents)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>SSCL ({(bill.ssclRate * 100).toFixed(1)}%)</Text>
                <Text style={styles.totVal}>{rs(bill.ssclCents)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>VAT ({(bill.vatRate * 100).toFixed(1)}%)</Text>
                <Text style={styles.totVal}>{rs(bill.vatCents)}</Text>
              </View>
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandVal}>{rs(bill.grandTotalCents)}</Text>
              </View>
            </View>
          </View>

          {isDraft && (
            <View style={{ marginTop: 12, padding: "6 10", backgroundColor: "#fef3c7", borderRadius: 4 }}>
              <Text style={{ fontSize: 7.5, color: "#92400e", fontFamily: "Helvetica-Bold" }}>
                DRAFT — This document is not a valid tax invoice until issued.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerSub}>{COMPANY.email} · {COMPANY.phone}</Text>
        </View>
      </Page>
    </Document>
  );
}

// Renders an invoice bill (with lineItems included) to a PDF Buffer.
export async function renderInvoicePdfBuffer(bill: any): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument bill={bill} />);
}
