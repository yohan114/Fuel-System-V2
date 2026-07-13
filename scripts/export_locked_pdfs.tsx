import { prisma } from "../src/lib/db";
import { renderInvoicePdfBuffer } from "../src/lib/billing/invoice-document";
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Export the LOCKED sites' final (ISSUED) June 2026 bills as PDFs: one consolidated
// summary per site + every individual invoice. Read-only — no bill regeneration.

const Y = 2026, M = 6, PERIOD = "June 2026";
const SITES: [string, string][] = [
  ["BATTI-02", "ICDP Batti Lot-02"], ["CEP-03F", "Galagedara (CEP-03 F)"], ["AMB", "Ambanpola"],
  ["KARA", "Karaitivu"], ["PALO", "Pallam Oya"], ["CEP-03E", "CEP-03 E Package"], ["MUTUR", "Mutur Plant"],
];
const NAVY = "#1e3a5f", AMBER = "#f59e0b", LIGHT = "#f8fafc", WHITE = "#fff", GRAY = "#64748b", GL = "#e2e8f0";
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const S = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", paddingBottom: 40 },
  band: { backgroundColor: NAVY, padding: "18 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  co: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  coSub: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right" },
  titleSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 3 },
  strip: { backgroundColor: AMBER, height: 3 },
  body: { padding: "16 32" },
  cards: { flexDirection: "row", gap: 8, marginBottom: 14 },
  card: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "8 10", borderWidth: 1, borderColor: GL },
  cardL: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  cardV: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },
  tHead: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.3 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GL, paddingVertical: 4, paddingHorizontal: 6 },
  alt: { backgroundColor: LIGHT },
  td: { fontSize: 7.5, color: "#334155" },
  cInv: { width: "20%" }, cVeh: { width: "14%" }, cType: { width: "24%" }, cRent: { width: "14%", textAlign: "right" }, cFuel: { width: "13%", textAlign: "right" }, cGrand: { width: "15%", textAlign: "right" },
  totBox: { flexDirection: "row", justifyContent: "flex-end", marginTop: 12 },
  tot: { width: "45%", borderWidth: 1, borderColor: GL, borderRadius: 4, overflow: "hidden" },
  tr: { flexDirection: "row", justifyContent: "space-between", padding: "5 10", borderBottomWidth: 1, borderBottomColor: GL },
  trG: { flexDirection: "row", justifyContent: "space-between", padding: "7 10", backgroundColor: NAVY },
  tl: { fontSize: 8, color: GRAY }, tv: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  tlG: { fontSize: 9, fontFamily: "Helvetica-Bold", color: WHITE }, tvG: { fontSize: 10, fontFamily: "Helvetica-Bold", color: AMBER },
  foot: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: GL, paddingTop: 6 },
  footT: { fontSize: 7, color: GRAY },
});

function SummaryDoc({ code, name, bills }: { code: string; name: string; bills: any[] }) {
  const sum = (k: string) => bills.reduce((s, b) => s + (b[k] || 0), 0);
  const sub = sum("subtotalCents"), sscl = sum("ssclCents"), vat = sum("vatCents"), grand = sum("grandTotalCents");
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.band}>
          <View><Text style={S.co}>EDWARD & CHRISTIE (PVT) LTD</Text><Text style={S.coSub}>Plant & Equipment Hire</Text></View>
          <View><Text style={S.title}>FINAL BILLS</Text><Text style={S.titleSub}>{name} · {PERIOD}</Text></View>
        </View>
        <View style={S.strip} />
        <View style={S.body}>
          <View style={S.cards}>
            <View style={S.card}><Text style={S.cardL}>Site</Text><Text style={S.cardV}>{code}</Text></View>
            <View style={S.card}><Text style={S.cardL}>Invoices</Text><Text style={S.cardV}>{bills.length}</Text></View>
            <View style={S.card}><Text style={S.cardL}>Grand Total</Text><Text style={S.cardV}>{rs(grand)}</Text></View>
          </View>
          <View style={S.tHead}>
            <Text style={[S.th, S.cInv]}>Invoice No.</Text><Text style={[S.th, S.cVeh]}>Vehicle</Text><Text style={[S.th, S.cType]}>Type / Basis</Text>
            <Text style={[S.th, S.cRent]}>Rental</Text><Text style={[S.th, S.cFuel]}>Fuel</Text><Text style={[S.th, S.cGrand]}>Grand</Text>
          </View>
          {bills.map((b, i) => (
            <View key={b.id} style={[S.tRow, ...(i % 2 ? [S.alt] : [])]} wrap={false}>
              <Text style={[S.td, S.cInv]}>{b.invoiceNumber || "—"}</Text>
              <Text style={[S.td, S.cVeh]}>{b.assetCode}</Text>
              <Text style={[S.td, S.cType]}>{(b.assetLabel || b.billingMode)} · {String(b.rateBasis).toUpperCase()}</Text>
              <Text style={[S.td, S.cRent]}>{rs(b.rentalAmountCents)}</Text>
              <Text style={[S.td, S.cFuel]}>{b.fuelCostCents ? rs(b.fuelCostCents) : "—"}</Text>
              <Text style={[S.td, S.cGrand, { fontFamily: "Helvetica-Bold", color: NAVY }]}>{rs(b.grandTotalCents)}</Text>
            </View>
          ))}
          <View style={S.totBox}><View style={S.tot}>
            <View style={S.tr}><Text style={S.tl}>Subtotal</Text><Text style={S.tv}>{rs(sub)}</Text></View>
            <View style={S.tr}><Text style={S.tl}>SSCL (2.5%)</Text><Text style={S.tv}>{rs(sscl)}</Text></View>
            <View style={S.tr}><Text style={S.tl}>VAT (18%)</Text><Text style={S.tv}>{rs(vat)}</Text></View>
            <View style={S.trG}><Text style={S.tlG}>GRAND TOTAL</Text><Text style={S.tvG}>{rs(grand)}</Text></View>
          </View></View>
        </View>
        <View style={S.foot} fixed><Text style={S.footT}>Edward & Christie (Pvt) Ltd — {name} — {PERIOD} (final / issued invoices)</Text><Text style={S.footT} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
}

function sani(s: string) { return s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, ""); }

async function main() {
  const base = path.join(process.cwd(), "billing_exports", "locked_June2026");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  let grandAll = 0, nAll = 0;
  const overview: { code: string; name: string; n: number; grand: number }[] = [];

  for (const [code, name] of SITES) {
    const bills = await prisma.bill.findMany({
      where: { projectCode: code, year: Y, month: M, status: { not: "DRAFT" } },
      include: { lineItems: true }, orderBy: { grandTotalCents: "desc" },
    });
    if (!bills.length) continue;
    const dir = path.join(base, sani(name));
    fs.mkdirSync(dir, { recursive: true });

    // Site summary
    const summary = await renderToBuffer(<SummaryDoc code={code} name={name} bills={bills} />);
    fs.writeFileSync(path.join(dir, `_SUMMARY_${code}_${Y}-${String(M).padStart(2, "0")}.pdf`), summary);

    // Individual invoices
    for (const b of bills) {
      try {
        const buf = await renderInvoicePdfBuffer(b);
        fs.writeFileSync(path.join(dir, `invoice_${sani(b.assetCode)}_${b.invoiceNumber || b.periodKey}.pdf`), buf);
      } catch (e: any) { console.error(`  ! ${code} ${b.assetCode}: ${e.message}`); }
    }
    const g = bills.reduce((s, b) => s + b.grandTotalCents, 0);
    grandAll += g; nAll += bills.length;
    overview.push({ code, name, n: bills.length, grand: g });
    console.log(`${code.padEnd(9)} ${bills.length} invoices  ${rs(g)}`);
  }
  console.log(`\nTOTAL ${nAll} invoices  ${rs(grandAll)}`);
  fs.writeFileSync(path.join(base, "_INDEX.txt"),
    `Edward & Christie (Pvt) Ltd — LOCKED SITES FINAL BILLS — ${PERIOD}\n\n` +
    overview.map((o) => `${o.code.padEnd(9)} ${o.name.padEnd(22)} ${String(o.n).padStart(2)} invoices   ${rs(o.grand)}`).join("\n") +
    `\n\nTOTAL    ${String(nAll).padStart(2)} invoices   ${rs(grandAll)}\n`);
  console.log(`\nSaved under ${base}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
