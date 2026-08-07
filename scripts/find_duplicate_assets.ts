import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Find machines the fleet may be holding twice — and judge each on evidence.
//
// Every site book writes a machine differently. The workshop register calls it
// DT-02, the site's daily sheet writes the plate LL-0920, and an importer that
// could not match the plate registered it as a machine in its own right. The
// fleet then carries one machine as two and its fuel splits between them.
//
// Resemblance is NOT evidence. 226-3544 and 226-3944 differ by one character and
// are a Double Cab and a Tipper; LP-1575 is one character from eight different
// tippers. Merging on how alike two plates look would put one machine's fuel on
// another's record, where nothing downstream would ever reveal it. So each
// candidate is weighed on facts the data can actually settle:
//
//   SAME DAY    both drew fuel on one day -> two machines. A machine cannot be
//               in two places, and one machine written two ways would not be
//               issued twice under different names on the same sheet.
//   CATEGORY    an excavator and a pickup are not the same machine.
//   METERS      sorted by date, do the two series form ONE rising line, or does
//               the merged sequence go backwards? A cumulative meter never falls.
//   AMBIGUOUS   one character from SEVERAL machines -> never guess.
//
// Read-only. Feed what survives to merge_assets.ts.
//
//   npx tsx scripts/find_duplicate_assets.ts

const alnum = (s: string | null) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
// Sri Lankan plate shapes. An E&C fleet number is a short prefix and one or two
// digits, so anything matching this is a machine filed under its registration.
const looksLikePlate = (c: string) =>
  /^[A-Z]{2,3}[-\s]?\d{4}$/i.test(c.trim()) || /^\d{2,3}[-\s]?\d{4}$/.test(c.trim());
// A regNo that is a model name, not a registration — three excavators share
// "14160" and three mixers share "FIORI", and none of those are duplicates.
const isRealPlate = (p: string) => /\d/.test(p) && /^[A-Z0-9]{1,3}[-\s]?\d{3,4}$/i.test(p.trim());

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function main() {
  console.log(`\n=== machines the fleet may hold twice ===`);
  announceDatabase();

  const assets = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true,
      project: { select: { code: true } }, category: { select: { name: true } } },
    orderBy: { code: "asc" } });
  const plateOwners = new Map<string, typeof assets>();
  for (const a of assets) {
    if (!a.regNo) continue;
    const k = alnum(a.regNo);
    (plateOwners.get(k) ?? plateOwners.set(k, []).get(k)!).push(a);
  }
  const platey = assets.filter((a) => looksLikePlate(a.code));
  console.log(`  ${assets.length} machines · ${platey.length} filed under a registration rather than a fleet number\n`);

  // ------------------------------------------ one machine's code is another's plate
  const exactPairs: string[] = [];
  for (const a of platey) {
    for (const b of plateOwners.get(alnum(a.code)) ?? []) {
      if (a.id === b.id) continue;
      exactPairs.push(`  "${a.code}" IS ${b.code}'s registration — certain\n      npx tsx scripts/merge_assets.ts --from="${a.code}" --into="${b.code}"`);
    }
  }
  console.log(`--- a machine's CODE is another's PLATE (${exactPairs.length}) — certain ---`);
  console.log(exactPairs.length ? exactPairs.join("\n") : "  none\n");

  // ---------------------------------------------------- two machines, one plate
  console.log(`\n--- two machines carrying the SAME plate ---`);
  let shared = 0;
  for (const [k, group] of plateOwners) {
    if (group.length < 2) continue;
    if (!isRealPlate(group[0].regNo!)) continue;     // a model name, not a plate
    shared++;
    console.log(`\n  plate ${group[0].regNo}:`);
    for (const a of group) {
      const n = await prisma.fuelIssue.count({ where: { assetId: a.id, voided: false } });
      const l = await prisma.fuelIssue.aggregate({ where: { assetId: a.id, voided: false }, _sum: { litres: true } });
      console.log(`      ${a.code.padEnd(12)} ${(a.category?.name ?? "—").padEnd(22)} ${(a.project?.code ?? "—").padEnd(11)} ${String(n).padStart(4)} issues ${Math.round(l._sum.litres ?? 0).toLocaleString().padStart(7)} L`);
    }
  }
  if (!shared) console.log("  none");

  // ------------------------------------------------------ one character apart
  const verdicts: { verdict: string; line: string; cmd?: string }[] = [];
  for (const a of platey) {
    if ((plateOwners.get(alnum(a.code)) ?? []).some((o) => o.id !== a.id)) continue;   // already exact
    const c = alnum(a.code);
    const cands = new Map<string, typeof assets[number]>();
    for (let i = 0; i < c.length; i++) {
      for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        if (ch === c[i]) continue;
        for (const o of plateOwners.get(c.slice(0, i) + ch + c.slice(i + 1)) ?? []) if (o.id !== a.id) cands.set(o.id, o);
      }
    }
    if (!cands.size) continue;

    const mine = await prisma.fuelIssue.findMany({ where: { assetId: a.id, voided: false },
      select: { issueDate: true, litres: true, meterReading: true } });
    if (cands.size > 1) {
      verdicts.push({ verdict: "AMBIGUOUS",
        line: `${a.code.padEnd(11)} ${String(mine.length).padStart(3)} issues — one character from ${cands.size}: ${[...cands.values()].map((x) => x.code).join(", ")}` });
      continue;
    }
    const twin = [...cands.values()][0];
    const theirs = await prisma.fuelIssue.findMany({ where: { assetId: twin.id, voided: false },
      select: { issueDate: true, litres: true, meterReading: true } });

    const myDays = new Set(mine.map((r) => dayOf(r.issueDate)));
    const clash = theirs.filter((r) => myDays.has(dayOf(r.issueDate)));
    const catSame = a.category?.name === twin.category?.name;

    const series = [...mine.filter((r) => r.meterReading != null).map((r) => ({ d: dayOf(r.issueDate), v: r.meterReading! })),
                    ...theirs.filter((r) => r.meterReading != null).map((r) => ({ d: dayOf(r.issueDate), v: r.meterReading! }))]
      .sort((x, y) => x.d.localeCompare(y.d));
    const bothHaveMeters = mine.some((r) => r.meterReading != null) && theirs.some((r) => r.meterReading != null);
    let chains: boolean | null = null;
    if (bothHaveMeters) { chains = true; for (let i = 1; i < series.length; i++) if (series[i].v < series[i - 1].v) chains = false; }

    const why: string[] = [];
    if (clash.length) why.push(`drew on the same day ${clash.length}x`);
    if (!catSame) why.push(`${a.category?.name} vs ${twin.category?.name}`);
    if (chains === true) why.push("meters form one rising series");
    if (chains === false) why.push("meters do NOT chain");

    const verdict = clash.length || !catSame || chains === false ? "KEEP APART"
      : chains === true ? "MERGE" : "UNDECIDED";
    verdicts.push({ verdict,
      line: `${a.code.padEnd(11)} ${String(mine.length).padStart(3)} issues  ->  ${twin.code} (${twin.regNo}, ${twin.project?.code ?? "—"}, ${String(theirs.length).padStart(3)} issues)   ${why.join(" · ") || "nothing separates them and nothing joins them"}`,
      cmd: verdict === "MERGE" ? `npx tsx scripts/merge_assets.ts --from="${a.code}" --into="${twin.code}" --apply` : undefined });
  }

  const headings: Record<string, string> = {
    MERGE: "the evidence says one machine — safe to merge",
    UNDECIDED: "no evidence either way — needs someone who knows the fleet",
    "KEEP APART": "the evidence says two machines — do NOT merge",
    AMBIGUOUS: "one character from several machines — never guess",
  };
  for (const v of ["MERGE", "UNDECIDED", "KEEP APART", "AMBIGUOUS"]) {
    const rows = verdicts.filter((x) => x.verdict === v);
    console.log(`\n--- ${v} (${rows.length}) — ${headings[v]} ---`);
    for (const r of rows) {
      console.log(`  ${r.line}`);
      if (r.cmd) console.log(`      ${r.cmd}`);
    }
    if (!rows.length) console.log("  none");
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
