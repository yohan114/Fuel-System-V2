import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY, EcLogo } from "./invoice-document";
import type { SiteSummary, SiteSummaryLine } from "./site-summary";

// The one-page summary a site is asked to agree to before anything is invoiced.
//
// Every figure on it traces to something the site holds a book for: the days a
// machine was posted here, the guarantee those days earn, and the litres its own
// pump issued. Nothing from another site's register appears.

const NAVY = "#0f172a";
const AMBER = "#f59e0b";
const WHITE = "#ffffff";
const LIGHT = "#f1f5f9";
const GRAY = "#64748b";
const GRAY_LIGHT = "#e2e8f0";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },
  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 6, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  titleSub: { fontSize: 9, fontFamily: "Helvetica-Bold", color: WHITE, textAlign: "right", marginTop: 4 },
  badge: { fontSize: 7, color: "#93c5fd", textAlign: "right", marginTop: 2, textTransform: "uppercase" },
  accentStrip: { backgroundColor: AMBER, height: 3 },

  infoBar: { backgroundColor: LIGHT, padding: "10 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  infoLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },

  body: { padding: "16 32 0 32" },
  sectionLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  note: { fontSize: 7.5, color: GRAY, marginTop: 4, lineHeight: 1.5 },

  thead: { flexDirection: "row", backgroundColor: NAVY, paddingVertical: 6, paddingHorizontal: 6 },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  thR: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" },
  tr: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  td: { fontSize: 8 },
  cMach: { width: "17%" }, cDays: { width: "6%", textAlign: "right" },
  cCons: { width: "12%", textAlign: "right" }, cMeter: { width: "11%", textAlign: "right" },
  cBill: { width: "11%", textAlign: "right" }, cRate: { width: "10%", textAlign: "right" },
  cRent: { width: "14%", textAlign: "right" }, cFuel: { width: "7%", textAlign: "right" }, cTot: { width: "12%", textAlign: "right" },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totals: { width: "56%" },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  totLabel: { fontSize: 8.5, color: GRAY },
  totVal: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: NAVY },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "8 10", marginTop: 6, borderRadius: 4 },
  grandLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.5 },
  grandVal: { fontSize: 12, fontFamily: "Helvetica-Bold", color: AMBER },

  warn: { marginTop: 12, padding: 8, backgroundColor: "#fef3c7", borderLeftWidth: 3, borderLeftColor: AMBER },
  warnText: { fontSize: 7.5, color: "#92400e", lineHeight: 1.5 },

  draft: { marginTop: 16, padding: 8, backgroundColor: LIGHT, textAlign: "center" },
  draftText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: GRAY, letterSpacing: 0.5 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: NAVY, padding: "10 32", flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: WHITE, fontFamily: "Helvetica-Bold" },
  footerSub: { fontSize: 7, color: "#93c5fd" },
});

const rs = (c: number) => "Rs. " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number) => x.toLocaleString("en-LK", { maximumFractionDigits: 1 });
const pct = (r: number) => (r * 100).toLocaleString("en-LK", { maximumFractionDigits: 1 });

function Row({ l }: { l: SiteSummaryLine }) {
  return (
    <View style={s.tr} wrap={false}>
      <View style={s.cMach}>
        <Text style={[s.td, { fontFamily: "Helvetica-Bold", color: NAVY }]}>{l.code}</Text>
        <Text style={[s.td, { fontSize: 7, color: GRAY }]}>{l.regNo ?? "—"}</Text>
      </View>
      <Text style={[s.td, s.cDays]}>{l.daysHere} / {l.daysInMonth}</Text>
      <View style={s.cCons}>
        <Text style={s.td}>{l.consRefUnits != null ? `${n1(l.consRefUnits)} ${l.unit}` : "—"}</Text>
        {l.consTypRate != null && (
          <Text style={[s.td, { fontSize: 6.5, color: GRAY }]}>@ {l.consTypRate} L/{l.unit}</Text>
        )}
      </View>
      <Text style={[s.td, s.cMeter]}>{l.actualUnits != null ? `${n1(l.actualUnits)} ${l.unit}` : "—"}</Text>
      <Text style={[s.td, s.cBill]}>{n1(l.billableUnits)} {l.unit}</Text>
      <Text style={[s.td, s.cRate]}>{l.rateCents != null ? rs(l.rateCents) : "no rate"}</Text>
      <Text style={[s.td, s.cRent]}>{rs(l.rentalCents)}</Text>
      <Text style={[s.td, s.cFuel]}>{n1(l.fuelLitres)} L</Text>
      <Text style={[s.td, s.cTot, { fontFamily: "Helvetica-Bold" }]}>{rs(l.lineTotalCents)}</Text>
    </View>
  );
}

export function SiteSummaryDocument({ summary, generatedAt }: { summary: SiteSummary; generatedAt: string }) {
  // An unread meter shows as "—" in its own column rather than as a notice: the
  // page states what each figure is, and lets the reader draw the conclusion.
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerBand}>
          <View style={s.logoBox}>
            <View style={s.logoMark}><EcLogo size={30} /></View>
            <View>
              <Text style={s.companyName}>{COMPANY.name}</Text>
              <Text style={s.companyDiv}>{COMPANY.division}</Text>
              <Text style={s.companyDoc}>Doc No: {COMPANY.docNumber}</Text>
            </View>
          </View>
          <View>
            <Text style={s.title}>SITE SUMMARY BILL</Text>
            <Text style={s.titleSub}>{summary.siteName}</Text>
            <Text style={s.badge}>DRAFT · {summary.monthLabel}</Text>
          </View>
        </View>
        <View style={s.accentStrip} />

        <View style={s.infoBar}>
          <View><Text style={s.infoLabel}>Site</Text><Text style={s.infoVal}>{summary.siteCode}</Text></View>
          <View><Text style={s.infoLabel}>Period</Text><Text style={s.infoVal}>{summary.monthLabel}</Text></View>
          <View><Text style={s.infoLabel}>Machines</Text><Text style={s.infoVal}>{summary.lines.length}</Text></View>
          <View><Text style={s.infoLabel}>Fuel issued here</Text><Text style={s.infoVal}>{n1(summary.fuelLitres)} L</Text></View>
          <View><Text style={s.infoLabel}>Generated</Text><Text style={s.infoVal}>{generatedAt}</Text></View>
        </View>

        <View style={s.body}>
          <Text style={s.sectionLabel}>Machines posted to this site</Text>
          <View style={s.thead}>
            <Text style={[s.th, s.cMach]}>Machine</Text>
            <Text style={[s.th, s.cDays]}>Days</Text>
            {/* Stacked on purpose — left to wrap, "(meter)" hyphenates to "(me-ter)". */}
            <View style={s.cCons}>
              <Text style={s.thR}>Actual</Text><Text style={s.thR}>(cons typ)</Text>
            </View>
            <View style={s.cMeter}>
              <Text style={s.thR}>Actual</Text><Text style={s.thR}>(meter)</Text>
            </View>
            <Text style={[s.th, s.cBill]}>Billable</Text>
            <Text style={[s.th, s.cRate]}>Rate</Text>
            <Text style={[s.th, s.cRent]}>Rental</Text>
            <Text style={[s.th, s.cFuel]}>Fuel</Text>
            <Text style={[s.th, s.cTot]}>Total</Text>
          </View>
          {summary.lines.map((l) => <Row key={l.assetId} l={l} />)}

          <View style={s.totalsWrap}>
            <View style={s.totals}>
              <View style={s.totRow}><Text style={s.totLabel}>Machine rental</Text><Text style={s.totVal}>{rs(summary.rentalCents)}</Text></View>
              <View style={s.totRow}>
                <Text style={s.totLabel}>
                  Fuel issued at this site ({n1(summary.fuelLitres)} L
                  {summary.fuelRateCents != null
                    ? ` @ ${rs(summary.fuelRateCents)}/L${summary.fuelRateBlended ? " avg" : ""}`
                    : ""})
                </Text>
                <Text style={s.totVal}>{rs(summary.fuelCostCents)}</Text>
              </View>
              <View style={s.totRow}><Text style={s.totLabel}>Subtotal</Text><Text style={s.totVal}>{rs(summary.subtotalCents)}</Text></View>
              <View style={s.totRow}><Text style={s.totLabel}>SSCL ({pct(summary.ssclRate)}%)</Text><Text style={s.totVal}>{rs(summary.ssclCents)}</Text></View>
              <View style={s.totRow}><Text style={s.totLabel}>Value liable to VAT</Text><Text style={s.totVal}>{rs(summary.subtotalCents + summary.ssclCents)}</Text></View>
              <View style={s.totRow}><Text style={s.totLabel}>VAT ({pct(summary.vatRate)}%)</Text><Text style={s.totVal}>{rs(summary.vatCents)}</Text></View>
              <View style={s.grandRow}>
                <Text style={s.grandLabel}>Site total</Text>
                <Text style={s.grandVal}>{rs(summary.grandTotalCents)}</Text>
              </View>
              <Text style={[s.note, { textAlign: "right" }]}>{COMPANY.vatReg}</Text>
            </View>
          </View>

          {(summary.unrated.length > 0 || summary.billedDirect.length > 0) && (
            <View style={s.warn}>
              {summary.billedDirect.length > 0 && (
                <Text style={s.warnText}>
                  {summary.billedDirect.join(", ")} {summary.billedDirect.length === 1 ? "was" : "were"} on
                  site this month but {summary.billedDirect.length === 1 ? "is" : "are"} settled direct with
                  the owner — neither rental nor fuel is charged here.
                </Text>
              )}
              {summary.unrated.length > 0 && (
                <Text style={s.warnText}>
                  {summary.unrated.join(", ")} {summary.unrated.length === 1 ? "has" : "have"} no rate card, so
                  no rental is charged for {summary.unrated.length === 1 ? "it" : "them"} above.
                </Text>
              )}
            </View>
          )}

          <View style={s.draft}>
            <Text style={s.draftText}>DRAFT — for site agreement. Not a tax invoice until issued.</Text>
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>{COMPANY.address}</Text>
          <Text style={s.footerSub}>{COMPANY.email} · {COMPANY.phone}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderSiteSummaryPdf(summary: SiteSummary): Promise<Buffer> {
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" });
  return renderToBuffer(<SiteSummaryDocument summary={summary} generatedAt={generatedAt} />);
}
