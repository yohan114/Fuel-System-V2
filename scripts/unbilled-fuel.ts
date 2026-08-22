/**
 * Machines that drew fuel in a month and produced no bill.
 *
 * Fuel out of a site's tank is the one record that shows a machine working
 * there, and since June that is the precondition for billing it. The converse
 * is the interesting case: diesel went out, the machine qualified, and still no
 * invoice line exists. Every row here is either work that was never charged or
 * a code that should not be treated as a machine at all.
 *
 * Why each row failed is printed alongside it, because the fix differs:
 *   no rate card   — nothing to price the hours at; add a card and re-run
 *   rates all zero — a card exists but every column is 0 or blank
 *   disposed       — struck off the fleet yet still being fuelled
 *   billed direct  — deliberately excluded; the client pays the supplier
 *   fuel-only      — flagged to carry fuel with no rental
 *   (blank)        — none of the above; look closer
 *
 * The site column is where the fuel came out of, since a machine with no bill
 * has no billing site to name.
 *
 *   npx tsx scripts/unbilled-fuel.ts 2026 6 7
 */
import { prisma } from "../src/lib/db";

const year = parseInt(process.argv[2] || "2026", 10);
const months = process.argv.slice(3).map((m) => parseInt(m, 10));
if (months.length === 0) {
  console.error("usage: npx tsx scripts/unbilled-fuel.ts <year> <month> [month...]");
  process.exit(1);
}

const rs = (c: number) => Math.round(c / 100).toLocaleString("en-LK");
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);
const n1 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

// A code the office uses to book a site's own bulk draw or a miscellaneous
// issue, rather than a machine anyone could invoice.
const isLedgerCode = (code: string) => /^(SITE-|OTH-)/i.test(code);

interface Row {
  code: string; regNo: string | null; label: string; status: string;
  issues: number; litres: number; costCents: number;
  reason: string; sites: string;
}

async function forMonth(month: number) {
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const lastDay = new Date(year, month, 0).getDate();
  // Colombo day boundaries: a calendar day is stored at 18:30Z the day before.
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
  const end = new Date(`${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999+05:30`);

  const billed = new Set(
    (await prisma.bill.findMany({ where: { periodKey }, select: { assetId: true } })).map((b) => b.assetId),
  );

  const issues = await prisma.fuelIssue.findMany({
    where: { voided: false, issueDate: { gte: start, lte: end } },
    select: {
      assetId: true, litres: true, totalCost: true,
      bulkTank: { select: { project: { select: { code: true } } } },
      asset: {
        select: {
          code: true, regNo: true, brand: true, model: true, typeLabel: true, status: true,
          meterType: true, billedDirect: true, billFuelOnly: true,
          category: { select: { name: true } },
          rentalRate: {
            select: {
              equipType: true, hrFwCents: true, hrWCents: true, hrDCents: true,
              dyFwCents: true, dyWCents: true, dyDCents: true,
              kmFwCents: true, kmWCents: true, kmDCents: true,
              portDwCents: true, portDdCents: true,
            },
          },
        },
      },
    },
  });

  const byAsset = new Map<string, Row & { tanks: Set<string> }>();
  for (const i of issues) {
    if (billed.has(i.assetId)) continue;
    const a = i.asset;
    let e = byAsset.get(i.assetId);
    if (!e) {
      const rate = a.rentalRate;
      // PORTABLE plant is priced off the two portable columns only; everything
      // else off hourly / daily / km. A card whose relevant columns are all
      // empty prices nothing, which reads on screen as "has a rate card".
      const cents = rate
        ? rate.equipType === "PORTABLE"
          ? [rate.portDwCents, rate.portDdCents]
          : [rate.hrFwCents, rate.hrWCents, rate.hrDCents, rate.dyFwCents, rate.dyWCents,
             rate.dyDCents, rate.kmFwCents, rate.kmWCents, rate.kmDCents,
             rate.portDwCents, rate.portDdCents]
        : [];
      const priced = cents.some((c) => (c ?? 0) > 0);

      const reasons: string[] = [];
      if (a.status === "DISPOSED") reasons.push("disposed");
      if (a.billedDirect) reasons.push("billed direct");
      if (a.billFuelOnly) reasons.push("fuel-only");
      if (!rate) reasons.push("no rate card");
      else if (!priced) reasons.push(`rates all zero (${rate.equipType.toLowerCase()})`);

      e = {
        code: a.code,
        regNo: a.regNo,
        label: [a.brand, a.model].filter(Boolean).join(" ").trim() || a.typeLabel || a.category.name,
        status: a.status,
        issues: 0, litres: 0, costCents: 0,
        reason: reasons.join(" · "),
        sites: "",
        tanks: new Set<string>(),
      };
      byAsset.set(i.assetId, e);
    }
    e.issues++;
    e.litres += i.litres;
    e.costCents += i.totalCost;
    const t = i.bulkTank?.project?.code;
    if (t) e.tanks.add(t);
  }

  const rows = [...byAsset.values()].map((r) => ({ ...r, sites: [...r.tanks].sort().join(",") }));
  rows.sort((a, b) => b.costCents - a.costCents);
  return { periodKey, rows };
}

function table(title: string, rows: Row[]) {
  if (rows.length === 0) return;
  const litres = rows.reduce((s, r) => s + r.litres, 0);
  const cost = rows.reduce((s, r) => s + r.costCents, 0);
  console.log(`\n  ${title} — ${rows.length} codes, ${n1(litres)} L, Rs ${rs(cost)}`);
  console.log(
    `  ${pad("Code", 22)}${pad("Reg no", 13)}${pad("Description", 24)}${padL("issues", 7)}` +
      `${padL("litres", 10)}${padL("fuel Rs", 12)}  ${pad("why no bill", 30)}fuelled at`,
  );
  for (const r of rows) {
    console.log(
      `  ${pad(r.code.slice(0, 21), 22)}${pad(r.regNo?.slice(0, 12), 13)}${pad(r.label.slice(0, 23), 24)}` +
        `${padL(r.issues, 7)}${padL(n1(r.litres), 10)}${padL(rs(r.costCents), 12)}  ${pad(r.reason.slice(0, 29), 30)}${r.sites}`,
    );
  }
}

async function main() {
  const all: { periodKey: string; rows: Row[] }[] = [];
  for (const m of months) all.push(await forMonth(m));

  for (const { periodKey, rows } of all) {
    const machines = rows.filter((r) => !isLedgerCode(r.code));
    const ledger = rows.filter((r) => isLedgerCode(r.code));
    console.log(`\n════════ ${periodKey} — fuel issued, no bill raised ════════`);
    table("MACHINES", machines);
    table("SITE / MISC LEDGER CODES (bulk draws, not billable plant)", ledger);
  }

  // Anything appearing in every month asked for is a standing gap, not a
  // one-off: the same machine has been burning diesel unbilled all along.
  if (all.length > 1) {
    const counts = new Map<string, { r: Row; months: number; litres: number; cost: number }>();
    for (const { rows } of all) {
      for (const r of rows) {
        const e = counts.get(r.code) ?? { r, months: 0, litres: 0, cost: 0 };
        e.months++; e.litres += r.litres; e.cost += r.costCents;
        counts.set(r.code, e);
      }
    }
    const persistent = [...counts.values()]
      .filter((e) => e.months === all.length && !isLedgerCode(e.r.code))
      .sort((a, b) => b.cost - a.cost);
    if (persistent.length) {
      console.log(`\n════════ unbilled in ALL ${all.length} months ════════`);
      console.log(`  ${pad("Code", 22)}${pad("Reg no", 13)}${padL("litres", 10)}${padL("fuel Rs", 12)}  why`);
      let l = 0, c = 0;
      for (const e of persistent) {
        l += e.litres; c += e.cost;
        console.log(`  ${pad(e.r.code.slice(0, 21), 22)}${pad(e.r.regNo?.slice(0, 12), 13)}${padL(n1(e.litres), 10)}${padL(rs(e.cost), 12)}  ${e.r.reason}`);
      }
      console.log(`  ${pad("TOTAL", 35)}${padL(n1(l), 10)}${padL(rs(c), 12)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
