import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { generateBillsForMonth } from "../src/lib/billing/generate";
import { renderInvoicePdfBuffer, COMPANY, EcLogo } from "../src/lib/billing/invoice-document";
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

// Initialize Prisma
const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

// Consolidated Document PDF styles and component definitions (copied from consolidated PDF route)
const NAVY = "#1e3a5f";
const AMBER = "#f59e0b";
const LIGHT = "#f8fafc";
const WHITE = "#ffffff";
const GRAY = "#64748b";
const GRAY_LIGHT = "#e2e8f0";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },
  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoBox: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { backgroundColor: WHITE, borderRadius: 6, padding: 5, alignItems: "center", justifyContent: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  companyDoc: { fontSize: 7, color: "#cbd5e1", marginTop: 2, letterSpacing: 0.3 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right", letterSpacing: 1 },
  docSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 4 },
  accentStrip: { backgroundColor: AMBER, height: 3 },
  infoBar: { backgroundColor: LIGHT, padding: "10 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  body: { padding: "14 32" },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  summaryCard: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "8 10", borderWidth: 1, borderColor: GRAY_LIGHT },
  summaryLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  summaryVal: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  secHeading: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, marginTop: 12 },
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
  siteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: NAVY, borderRadius: 4, padding: "7 12", marginTop: 16, marginBottom: 6 },
  siteName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE },
  siteMeta: { fontSize: 7.5, color: "#93c5fd" },
  siteSubtotalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, backgroundColor: LIGHT, borderRadius: 3, padding: "5 12", marginTop: 4, borderWidth: 1, borderColor: GRAY_LIGHT },
  siteSubLabel: { fontSize: 7.5, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  siteSubVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },
});

const STATUS_COLORS: Record<string, string> = {
  PAID: "#065f46",
  ISSUED: "#1e40af",
  DRAFT: "#92400e",
  OVERDUE: "#991b1b",
};

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

          <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <View key={status} style={{ backgroundColor: LIGHT, borderRadius: 4, padding: "5 8", borderWidth: 1, borderColor: GRAY_LIGHT }}>
                <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: STATUS_COLORS[status] || GRAY }}>{status}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155" }}>{count as number}</Text>
              </View>
            ))}
          </View>

          {siteGroups.map((group) => {
            const st = sumBills(group.bills);
            return (
              <View key={group.name} style={{ marginBottom: 16 }}>
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

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerSub} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Function to render Consolidated Document to a buffer
async function renderConsolidatedPdfBuffer(bills: any[], periodKey: string, generatedAt: string): Promise<Buffer> {
  return renderToBuffer(<ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} />);
}

// Helper to sanitize directory name
function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function main() {
  console.log("=== PDF Auto-Exporter & Bill Generator ===");

  // Find Admin user
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    throw new Error("No admin user found in database.");
  }
  console.log(`Using admin actor: ${admin.name} (${admin.id})`);

  // Query distinct dates in DB to discover all months with data
  const fuelIssues = await prisma.fuelIssue.findMany({ select: { issueDate: true } });
  const dailyConditions = await prisma.dailyCondition.findMany({ select: { logDate: true } });
  const meterReadings = await prisma.meterReading.findMany({ select: { readingDate: true } });
  const existingBills = await prisma.bill.findMany({ select: { year: true, month: true } });

  const periodsSet = new Set<string>();
  
  const addDate = (d: Date | null) => {
    if (!d) return;
    const date = new Date(d);
    if (!isNaN(date.getTime())) {
      periodsSet.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
  };

  fuelIssues.forEach(x => addDate(x.issueDate));
  dailyConditions.forEach(x => addDate(x.logDate));
  meterReadings.forEach(x => addDate(x.readingDate));
  existingBills.forEach(x => periodsSet.add(`${x.year}-${String(x.month).padStart(2, "0")}`));

  const periods = [...periodsSet].map(p => {
    const [y, m] = p.split("-").map(Number);
    return { year: y, month: m, key: p };
  }).filter(p => p.year >= 2024 && p.year <= 2028)
    .sort((a, b) => a.key.localeCompare(b.key));

  console.log(`Discovered ${periods.length} months with data: ${periods.map(p => p.key).join(", ")}`);

  const exportBaseDir = path.join(process.cwd(), "billing_exports");
  if (!fs.existsSync(exportBaseDir)) {
    fs.mkdirSync(exportBaseDir, { recursive: true });
  }

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  for (const p of periods) {
    console.log(`\n--------------------------------------------`);
    console.log(`Processing Month: ${p.key}`);
    console.log(`--------------------------------------------`);

    // 1. Generate/Regenerate bills for the month in DB
    console.log(`Generating/updating bills in database...`);
    const genResult = await generateBillsForMonth({
      year: p.year,
      month: p.month,
      regenerate: true,
      actorId: admin.id
    });
    console.log(`Outcome: Created=${genResult.created}, Regenerated=${genResult.regenerated}, NoRate=${genResult.noRate}, Errors=${genResult.errors.length}`);

    if (genResult.errors.length > 0) {
      console.warn("Errors during generation:", genResult.errors);
    }

    // 2. Fetch all bills generated for this month
    const bills = await prisma.bill.findMany({
      where: { year: p.year, month: p.month },
      include: { lineItems: true }
    });

    if (bills.length === 0) {
      console.log(`No bills generated for ${p.key}. Skipping PDF exports.`);
      continue;
    }

    // 3. Group bills by site (project)
    const siteGroups = new Map<string, { code: string; name: string; bills: any[] }>();
    for (const bill of bills) {
      const projectId = bill.projectId || "unassigned";
      const projectCode = bill.projectCode || "UNASSIGNED";
      const projectName = bill.projectName || "Unassigned";
      if (!siteGroups.has(projectId)) {
        siteGroups.set(projectId, { code: projectCode, name: projectName, bills: [] });
      }
      siteGroups.get(projectId)!.bills.push(bill);
    }

    console.log(`Found ${siteGroups.size} site(s) with bills for this period.`);

    const monthDir = path.join(exportBaseDir, p.key);
    fs.mkdirSync(monthDir, { recursive: true });

    // 4. Export PDFs for each site
    for (const [projectId, group] of siteGroups.entries()) {
      const siteNameSanitized = sanitizeName(group.name);
      const siteDir = path.join(monthDir, siteNameSanitized);
      fs.mkdirSync(siteDir, { recursive: true });

      console.log(`Site: ${group.name} (${group.code}) -> Folder: ${p.key}/${siteNameSanitized}`);

      // A. Export individual bill PDFs
      for (const bill of group.bills) {
        try {
          const pdfBuffer = await renderInvoicePdfBuffer(bill);
          const pdfName = `invoice_${bill.assetCode}_${bill.periodKey}.pdf`;
          fs.writeFileSync(path.join(siteDir, pdfName), pdfBuffer);
          console.log(`  Saved: ${pdfName}`);
        } catch (err: any) {
          console.error(`  Error rendering invoice PDF for asset ${bill.assetCode}:`, err);
        }
      }

      // B. Export site monthly summary PDF
      try {
        const consolidatedBuffer = await renderConsolidatedPdfBuffer(group.bills, p.key, generatedAt);
        const summaryPdfName = `monthly_summary_${group.code}_${p.key}.pdf`;
        fs.writeFileSync(path.join(siteDir, summaryPdfName), consolidatedBuffer);
        console.log(`  Saved summary: ${summaryPdfName}`);
      } catch (err: any) {
        console.error(`  Error rendering consolidated PDF for site ${group.name}:`, err);
      }
    }
  }

  console.log("\n=============================================");
  console.log("PDF Auto-Export Complete!");
  console.log(`All files saved in: ${exportBaseDir}`);
  console.log("=============================================");
}

main()
  .catch(err => {
    console.error("Fatal error running PDF exporter:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
