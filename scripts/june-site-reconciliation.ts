/**
 * Reconcile a month's bills at one site against the evidence that the machine
 * was actually there.
 *
 * WHAT THIS IS NOT: a claim that a machine with no fuel should not be billed.
 * The guaranteed minimum is a floor, not a cap, and it exists precisely so an
 * idle machine still earns — a parked excavator burns no diesel and is still
 * denied to anyone else. Under the owner's own attachment rule a fuel gap does
 * NOT end a vehicle's presence at a site.
 *
 * WHAT IT IS: a test of whether the ATTACHMENT is supported. A bill is only as
 * good as the claim that the machine was on that site that month, and the only
 * site-level evidence this system holds is which tank the diesel came out of.
 * So each billed vehicle is graded:
 *
 *   CONFIRMED   drew fuel from that site's tank during the month
 *   CONTINUOUS  no fuel that month, but drew at the same site either side of it —
 *               an idle machine that never left, exactly what the minimum is for
 *   ELSEWHERE   drew fuel at a DIFFERENT site that month — the attachment is
 *               probably wrong, and another site should carry the charge
 *   NO EVIDENCE no fuel at this site in the month before, the month itself or
 *               the month after, and none anywhere else either — nothing in the
 *               system substantiates the machine being there at all
 *
 * Only ELSEWHERE and NO EVIDENCE are questionable. CONFIRMED and CONTINUOUS are
 * properly billed under the rules as they stand.
 *
 *   npx tsx scripts/june-site-reconciliation.ts 2026 6 "CEP-03 Wadakada" "Badalgama Plant"
 */
import { prisma } from "../src/lib/db";
import * as XLSX from "xlsx";

const year = parseInt(process.argv[2] || "2026", 10);
const month = parseInt(process.argv[3] || "6", 10);
const siteArgs = process.argv.slice(4);
const SITES = siteArgs.length ? siteArgs : ["CEP-03 Wadakada", "Badalgama Plant"];

const pk = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

const rs = (c: number) => (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);

// Graded against the machine's ENTIRE fuel history, not a window either side of
// the month. A three-month view called six Wadakada generators "no evidence"
// when the truth was sharper and more useful: two had not arrived until August,
// one has only ever fuelled at Galagedara, and three have never drawn diesel
// anywhere in the life of the system.
type Verdict =
  | "CONFIRMED"        // drew fuel here, this month
  | "CONTINUOUS"       // drew here before and/or after — present but idle
  | "ELSEWHERE"        // drew at another site this month
  | "ARRIVED LATER"    // first fuel anywhere postdates the month
  | "ONLY OTHER SITES" // has a fuel history, never at this site
  | "NEVER FUELLED";   // no fuel anywhere, ever

const VERDICTS: Verdict[] = ["CONFIRMED", "CONTINUOUS", "ELSEWHERE", "ARRIVED LATER", "ONLY OTHER SITES", "NEVER FUELLED"];
// The first two are properly billed under the owner's rules; the rest are not
// substantiated and are what a client would challenge.
const SOUND: Verdict[] = ["CONFIRMED", "CONTINUOUS"];

async function main() {
  // Fuel by (asset, site, month) for the three months in play. Colombo day rule:
  // a calendar day is stored at 18:30Z on the previous day, so bucketing on the
  // raw column would shift every issue by one day.
  const fuel = await prisma.$queryRawUnsafe<
    { assetCode: string; site: string; ym: string; litres: number; draws: bigint }[]
  >(`
    SELECT a.code AS assetCode, p.name AS site,
           substr(date(datetime(f.issueDate,'+5 hours','+30 minutes')),1,7) AS ym,
           SUM(f.litres) AS litres, COUNT(*) AS draws
    FROM FuelIssue f
    JOIN Asset a ON a.id = f.assetId
    JOIN BulkTank t ON t.id = f.bulkTankId
    JOIN Project p ON p.id = t.projectId
    WHERE f.voided = 0
    GROUP BY a.code, p.name, ym
  `);

  const key = (c: string, s: string, m: string) => `${c}|${s}|${m}`;
  const byKey = new Map(fuel.map((r) => [key(r.assetCode, r.site, r.ym), r]));
  const monthOf = new Map<string, { site: string; litres: number }[]>();
  for (const r of fuel) {
    if (r.ym !== pk(year, month)) continue;
    const list = monthOf.get(r.assetCode) ?? [];
    list.push({ site: r.site, litres: r.litres });
    monthOf.set(r.assetCode, list);
  }

  const wb = XLSX.utils.book_new();
  const grand = { billed: 0, confirmed: 0, continuous: 0, elsewhere: 0, none: 0 };

  for (const site of SITES) {
    const bills = await prisma.bill.findMany({
      where: { periodKey: pk(year, month), projectName: site },
      select: {
        assetCode: true, assetRegNo: true, assetLabel: true, billingMode: true, rateBasis: true,
        billableUnits: true, minimumUnits: true, fuelLitres: true, rentalAmountCents: true,
        grandTotalCents: true, status: true,
      },
      orderBy: { grandTotalCents: "desc" },
    });

    const rows = bills.map((b) => {
      const here = byKey.get(key(b.assetCode, site, pk(year, month)));
      const before = byKey.get(key(b.assetCode, site, pk(prev.y, prev.m)));
      const after = byKey.get(key(b.assetCode, site, pk(next.y, next.m)));
      const elsewhere = (monthOf.get(b.assetCode) ?? []).filter((x) => x.site !== site);

      const history = fuel.filter((f) => f.assetCode === b.assetCode);
      const everHere = history.filter((f) => f.site === site);
      const firstEver = history.map((f) => f.ym).sort()[0];

      let verdict: Verdict;
      if (here) verdict = "CONFIRMED";
      else if (before || after) verdict = "CONTINUOUS";
      else if (elsewhere.length) verdict = "ELSEWHERE";
      else if (history.length === 0) verdict = "NEVER FUELLED";
      else if (firstEver > pk(year, month)) verdict = "ARRIVED LATER";
      else if (everHere.length === 0) verdict = "ONLY OTHER SITES";
      else verdict = "CONTINUOUS"; // fuelled here, just not in the adjacent months

      // A short, readable account of where this machine has actually been.
      const trail = history.length
        ? [...history].sort((x, y) => (x.ym < y.ym ? -1 : 1)).map((f) => `${f.ym} ${f.site} ${Math.round(f.litres)}L`).join("; ")
        : "no fuel anywhere, ever";

      return {
        ...b,
        hereL: here?.litres ?? 0,
        beforeL: before?.litres ?? 0,
        afterL: after?.litres ?? 0,
        elsewhere: elsewhere.map((x) => `${x.site} ${Math.round(x.litres)}L`).join("; "),
        trail,
        verdict,
      };
    });

    const sum = (v: Verdict) => rows.filter((r) => r.verdict === v).reduce((s, r) => s + r.grandTotalCents, 0);
    const cnt = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
    const billed = rows.reduce((s, r) => s + r.grandTotalCents, 0);
    grand.billed += billed;
    grand.confirmed += sum("CONFIRMED");
    grand.continuous += sum("CONTINUOUS");
    grand.elsewhere += sum("ELSEWHERE");
    grand.none += VERDICTS.filter((v) => !SOUND.includes(v) && v !== "ELSEWHERE").reduce((n, v) => n + sum(v), 0);

    console.log(`\n════ ${site} — ${pk(year, month)} ════`);
    console.log(`  ${rows.length} vehicles billed, Rs ${rs(billed)}\n`);
    console.log(`  ${pad("E&C", 12)}${pad("Reg", 12)}${padL("billed", 9)}${padL(`${pk(prev.y, prev.m)} L`, 10)}${padL("this L", 8)}${padL(`${pk(next.y, next.m)} L`, 10)}  ${pad("verdict", 12)}${pad("grand", 15)}where else`);
    for (const r of rows) {
      console.log(
        `  ${pad(r.assetCode, 12)}${pad(r.assetRegNo && r.assetRegNo !== r.assetCode ? r.assetRegNo : "—", 12)}` +
        `${padL(Math.round(r.billableUnits), 9)}${padL(Math.round(r.beforeL) || "—", 10)}${padL(Math.round(r.hereL) || "—", 8)}${padL(Math.round(r.afterL) || "—", 10)}  ` +
        `${pad(r.verdict, 12)}${pad("Rs " + rs(r.grandTotalCents), 15)}${r.elsewhere || ""}`
      );
    }
    console.log(`\n  ── verdict ──`);
    for (const v of VERDICTS) {
      const c = cnt(v), s = sum(v);
      if (c) console.log(`  ${pad(v, 13)}${padL(c, 4)} vehicles   Rs ${padL(rs(s), 16)}   ${((s / billed) * 100).toFixed(1)}%`);
    }
    const qC = VERDICTS.filter((v) => !SOUND.includes(v)).reduce((n, v) => n + cnt(v), 0);
    const qS = VERDICTS.filter((v) => !SOUND.includes(v)).reduce((n, v) => n + sum(v), 0);
    console.log(`  ${pad("QUESTIONABLE", 13)}${padL(qC, 4)} vehicles   Rs ${padL(rs(qS), 16)}   ${((qS / billed) * 100).toFixed(1)}%`);

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [`${site} — ${pk(year, month)} reconciliation`],
        [`CONFIRMED = drew fuel here this month. CONTINUOUS = idle here but drew either side (properly billed at the minimum).`],
        [`ELSEWHERE = drew fuel at another site this month. NO EVIDENCE = nothing anywhere in ${pk(prev.y, prev.m)}–${pk(next.y, next.m)}.`],
        [],
        ["E&C No", "Reg No", "Description", "Mode", "Basis", "Billed units", "Minimum",
         `${pk(prev.y, prev.m)} L here`, "This month L here", `${pk(next.y, next.m)} L here`,
         "Fuel elsewhere this month", "Where it has actually been", "Verdict", "Grand Total (LKR)", "Status"],
        ...rows.map((r) => [
          r.assetCode, r.assetRegNo, r.assetLabel, r.billingMode, r.rateBasis,
          Math.round(r.billableUnits * 10) / 10, r.minimumUnits,
          Math.round(r.beforeL), Math.round(r.hereL), Math.round(r.afterL),
          r.elsewhere, r.trail, r.verdict, r.grandTotalCents / 100, r.status,
        ]),
        [],
        ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", billed / 100],
        ["QUESTIONABLE (everything not CONFIRMED or CONTINUOUS)", "", "", "", "", "", "", "", "", "", "", "", "",
         VERDICTS.filter((v) => !SOUND.includes(v)).reduce((n, v) => n + sum(v), 0) / 100],
      ]),
      site.slice(0, 28).replace(/[\\\/?*\[\]]/g, "")
    );
  }

  console.log(`\n════ BOTH SITES ════`);
  console.log(`  billed          Rs ${padL(rs(grand.billed), 16)}`);
  console.log(`  confirmed       Rs ${padL(rs(grand.confirmed), 16)}   drew fuel on site`);
  console.log(`  continuous      Rs ${padL(rs(grand.continuous), 16)}   idle on site, properly billed`);
  console.log(`  elsewhere       Rs ${padL(rs(grand.elsewhere), 16)}   another site should carry this`);
  console.log(`  no evidence     Rs ${padL(rs(grand.none), 16)}   nothing substantiates presence`);
  console.log(`  QUESTIONABLE    Rs ${padL(rs(grand.elsewhere + grand.none), 16)}   ${(((grand.elsewhere + grand.none) / grand.billed) * 100).toFixed(1)}% of the billed value`);

  XLSX.writeFile(wb, `out/june-reconciliation-${pk(year, month)}.xlsx`);
  console.log(`\n  written: out/june-reconciliation-${pk(year, month)}.xlsx`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
