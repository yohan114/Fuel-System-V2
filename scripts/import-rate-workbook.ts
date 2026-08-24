/**
 * Bring the 2026 rate workbook into the system.
 *
 * Dry-run by default; pass --apply to commit.
 *
 *   npx tsx scripts/import-rate-workbook.ts --file="...Fleet_Rental_Prices_2026_fuel_v9.xlsx"
 *   npx tsx scripts/import-rate-workbook.ts --file="..." --apply
 *
 * Three things come across, in the order they matter:
 *
 *   1. FUEL CONSUMPTION, per unit, from the 'Fuel Rates' sheet. This is the
 *      figure the billing engine divides litres by to derive hours or
 *      kilometres, so it decides what a machine is billed for whenever the
 *      meter was not read — which on this fleet is most of the time.
 *
 *   2. FUEL PRICES from the same sheet's input block. These drive new fuel
 *      issues; every issue already recorded keeps the price it was issued at.
 *
 *   3. RENTAL RATES, wet and dry, from the 'Fleet Pricing' sheet.
 *
 * UNITS. The workbook states road-vehicle consumption as km/L — kilometres you
 * get from a litre — and the system stores litres per unit for everything, so
 * road figures are inverted on the way in. Getting this backwards is a 100×
 * error on a lorry, not a rounding difference, so the basis is written
 * explicitly rather than left to be inferred from magnitude.
 */
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/db";

const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
const APPLY = process.argv.includes("--apply");
const FILE = arg("file");
if (!FILE) {
  console.error('usage: npx tsx scripts/import-rate-workbook.ts --file="<workbook.xlsx>" [--apply]');
  process.exit(1);
}

const rs = (c: number) => "Rs " + Math.round(c / 100).toLocaleString("en-LK");
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);
const n2 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-LK", { maximumFractionDigits: 4 }));
const norm = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");

interface ConsRow {
  code: string; reg: string; category: string; basis: "hr" | "km" | null;
  econ: number | null; typ: number | null; heavy: number | null;
  sourceUnit: string;
}
interface PriceRow { code: string; reg: string; wetCents: number | null; dryCents: number | null; category: string }

function readWorkbook() {
  const wb = XLSX.readFile(FILE);

  // ── consumption ───────────────────────────────────────────────────────────
  const fr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Fuel Rates"], { header: 1, defval: null });
  const head = fr.findIndex((r) => Array.isArray(r) && String(r[1] ?? "").trim() === "E&C No");
  if (head < 0) throw new Error("could not find the header row on 'Fuel Rates'");
  const col = Object.fromEntries((fr[head] as any[]).map((h, i) => [String(h ?? "").trim(), i]));

  const cons: ConsRow[] = [];
  for (const r of fr.slice(head + 1)) {
    const code = String(r?.[col["E&C No"]] ?? "").trim();
    const reg = String(r?.[col["Reg No"]] ?? "").trim();
    // A row identified only by its plate is still a machine.
    if ((!code || code === "—") && (!reg || reg === "—")) continue;
    const unit = String(r[col["Unit"]] ?? "").trim();
    const raw = (k: string) => {
      const v = r[col[k]];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    };
    // km/L on the sheet, litres-per-km in the system.
    const conv = (v: number | null) => (v == null ? null : unit === "km/L" ? 1 / v : v);
    cons.push({
      code: code === "—" ? "" : code,
      reg: reg === "—" ? "" : reg,
      category: String(r[col["Category"]] ?? "").trim(),
      basis: unit === "km/L" ? "km" : unit === "L/hr" ? "hr" : null,
      econ: conv(raw("Cons Econ")),
      typ: conv(raw("Cons Typ")),
      heavy: conv(raw("Cons Heavy")),
      sourceUnit: unit,
    });
  }

  // Fuel prices from the input block above the table.
  const priceOf = (label: string) => {
    const row = fr.find((r) => Array.isArray(r) && String(r[0] ?? "").startsWith(label));
    const v = row?.find((c: any) => typeof c === "number");
    return typeof v === "number" ? v : null;
  };
  const fuelPrices = {
    AUTO_DIESEL: priceOf("Auto Diesel"),
    PETROL_92: priceOf("Petrol 92"),
  };

  // ── rental rates ──────────────────────────────────────────────────────────
  const fp = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Fleet Pricing"], { header: 1, defval: null });
  const phead = fp.findIndex((r) => Array.isArray(r) && String(r[3] ?? "").trim() === "E&C No.");
  const pcol = Object.fromEntries((fp[phead] as any[]).map((h, i) => [String(h ?? "").trim(), i]));

  const prices: PriceRow[] = [];
  for (const r of fp.slice(phead + 1)) {
    const code = String(r?.[pcol["E&C No."]] ?? "").trim();
    const reg = String(r?.[pcol["Registration No."]] ?? "").trim();
    if (typeof r[0] !== "number") continue;
    if ((!code || code === "—") && (!reg || reg === "—")) continue;
    const cents = (k: string) => {
      const v = r[pcol[k]];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
    };
    prices.push({
      code: code === "—" ? "" : code,
      reg: reg === "—" ? "" : reg,
      category: String(r[pcol["Category"]] ?? "").trim(),
      wetCents: cents("Hourly WET"),
      dryCents: cents("Hourly DRY"),
    });
  }

  return { cons, prices, fuelPrices };
}

async function main() {
  const { cons, prices, fuelPrices } = readWorkbook();

  console.log(`\n════ RATE WORKBOOK → SYSTEM  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
  console.log(`  ${FILE}`);
  console.log(`\n  workbook holds ${cons.length} consumption rows and ${prices.length} priced units`);
  console.log(`  fuel prices: auto diesel Rs ${fuelPrices.AUTO_DIESEL}/L · petrol 92 Rs ${fuelPrices.PETROL_92}/L`);

  // ── match to the fleet ────────────────────────────────────────────────────
  const assets = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true, status: true, rentalRate: true },
  });
  const byCode = new Map(assets.map((a) => [norm(a.code), a]));
  // 43 workbook rows carry no E&C number but do carry a plate — LI-7620,
  // PJ-7604 and the rest. Matching on the code alone dropped them silently,
  // which for a fuel model is the worst kind of miss: the machine keeps a stale
  // figure and nothing says so.
  const byReg = new Map(assets.filter((a) => a.regNo).map((a) => [norm(a.regNo), a]));
  const find = (code: string, reg?: string) =>
    byCode.get(norm(code)) ?? (reg ? byReg.get(norm(reg)) ?? null : null);

  const unmatched: string[] = [];
  for (const c of cons) if (!find(c.code, c.reg)) unmatched.push(c.code || c.reg || "?");

  console.log(`\n  ${cons.length - unmatched.length} of ${cons.length} consumption rows match a machine here`);
  if (unmatched.length) {
    console.log(`  not in this fleet (${unmatched.length}): ${unmatched.slice(0, 20).join(", ")}${unmatched.length > 20 ? " …" : ""}`);
  }

  // ── 1. consumption ────────────────────────────────────────────────────────
  interface Change { code: string; field: string; from: unknown; to: unknown }
  const consChanges: Change[] = [];
  const basisConflicts: string[] = [];
  let consUnchanged = 0;

  for (const c of cons) {
    const a = find(c.code, c.reg);
    if (!a || !a.rentalRate) continue;
    const r = a.rentalRate;

    // The band must match the machine's meter or the engine refuses it. A
    // mismatch here is the workbook and the fleet disagreeing about what the
    // machine is, which is worth saying out loud rather than writing anyway.
    const meterBasis = a.meterType === "KM" ? "km" : a.meterType === "HOURS" ? "hr" : null;
    if (c.basis && meterBasis && c.basis !== meterBasis) {
      basisConflicts.push(`${c.code}: workbook says ${c.sourceUnit}, fleet says the meter is ${a.meterType}`);
      continue;
    }

    const near = (x: number | null, y: number | null) =>
      x == null && y == null ? true : x == null || y == null ? false : Math.abs(x - y) < 1e-9;

    let touched = false;
    if (!near(r.fuelConsEcon, c.econ)) { consChanges.push({ code: c.code, field: "econ", from: r.fuelConsEcon, to: c.econ }); touched = true; }
    if (!near(r.fuelConsTyp, c.typ)) { consChanges.push({ code: c.code, field: "typ", from: r.fuelConsTyp, to: c.typ }); touched = true; }
    if (!near(r.fuelConsHeavy, c.heavy)) { consChanges.push({ code: c.code, field: "heavy", from: r.fuelConsHeavy, to: c.heavy }); touched = true; }
    if (r.fuelConsBasis !== c.basis) { consChanges.push({ code: c.code, field: "basis", from: r.fuelConsBasis, to: c.basis }); touched = true; }
    if (!touched) consUnchanged++;
  }

  const typMoves = consChanges.filter((c) => c.field === "typ");
  console.log(`\n── 1. FUEL CONSUMPTION ──`);
  console.log(`  ${consUnchanged} machines already agree with the workbook`);
  console.log(`  ${typMoves.length} would have their TYPICAL consumption changed — the figure billing divides litres by`);
  console.log(`  ${consChanges.filter((c) => c.field === "basis").length} would have their basis set or corrected`);
  if (basisConflicts.length) {
    console.log(`\n  HELD BACK — ${basisConflicts.length} where the workbook and the fleet disagree about the meter:`);
    for (const b of basisConflicts.slice(0, 12)) console.log(`    ${b}`);
    if (basisConflicts.length > 12) console.log(`    … and ${basisConflicts.length - 12} more`);
  }

  const big = typMoves
    .map((c) => ({ ...c, ratio: c.from && c.to ? (c.to as number) / (c.from as number) : null }))
    .filter((c) => c.ratio != null && (c.ratio > 1.5 || c.ratio < 0.67))
    .sort((a, b) => Math.abs(Math.log(b.ratio!)) - Math.abs(Math.log(a.ratio!)));
  if (big.length) {
    console.log(`\n  ${big.length} of those move by more than half again — worth an eye before applying:`);
    console.log(`    ${pad("machine", 12)}${padL("now", 12)}${padL("workbook", 12)}   effect on billed units`);
    for (const c of big.slice(0, 15)) {
      // units = litres ÷ consumption, so a bigger consumption means fewer units.
      console.log(`    ${pad(c.code, 12)}${padL(n2(c.from as number), 12)}${padL(n2(c.to as number), 12)}   ${c.ratio! > 1 ? "×" + (1 / c.ratio!).toFixed(2) + " units" : "×" + (1 / c.ratio!).toFixed(2) + " units"}`);
    }
    if (big.length > 15) console.log(`    … and ${big.length - 15} more`);
  }

  // ── 2. fuel prices ────────────────────────────────────────────────────────
  console.log(`\n── 2. FUEL PRICES ──`);
  for (const [kind, rupees] of Object.entries(fuelPrices)) {
    if (rupees == null) continue;
    const current = await prisma.fuelPrice.findFirst({
      where: { fuelKind: kind }, orderBy: { effectiveFrom: "desc" },
      select: { pricePerLitre: true, effectiveFrom: true },
    });
    const cents = Math.round(rupees * 100);
    console.log(
      `  ${pad(kind, 14)} system ${padL(current ? rs(current.pricePerLitre) : "none", 10)}` +
      ` → workbook ${padL(rs(cents), 10)}` +
      (current && current.pricePerLitre === cents ? "   unchanged" : "   CHANGES new issues only; recorded issues keep their own price"),
    );
  }

  // ── 3. rental rates ───────────────────────────────────────────────────────
  console.log(`\n── 3. RENTAL RATES ──`);
  let wetSet = 0, wetSame = 0, drySet = 0, noRate = 0, basisFlip = 0;
  const wetMoves: { code: string; from: number | null; to: number }[] = [];

  for (const p of prices) {
    const a = find(p.code, p.reg);
    if (!a) continue;
    if (!a.rentalRate) { noRate++; continue; }
    const r = a.rentalRate;
    const isKm = a.meterType === "KM";
    const curWet = isKm ? r.kmWCents : r.hrWCents;
    const curDry = isKm ? r.kmDCents : r.hrDCents;

    if (p.wetCents != null) {
      if (curWet !== p.wetCents) { wetSet++; wetMoves.push({ code: p.code, from: curWet, to: p.wetCents }); }
      else wetSame++;
    }
    if (p.dryCents != null && curDry !== p.dryCents) drySet++;
    if (r.defaultBasis !== "w") basisFlip++;
  }

  console.log(`  ${wetSame} wet rates already match`);
  console.log(`  ${wetSet} wet rates would change`);
  console.log(`  ${drySet} dry rates would change`);
  console.log(`  ${basisFlip} machines would be switched to bill WET by default`);
  if (noRate) console.log(`  ${noRate} priced in the workbook but hold no rate card here — a card would be created`);

  if (wetMoves.length) {
    const up = wetMoves.filter((m) => m.from != null && m.to > m.from).length;
    const down = wetMoves.filter((m) => m.from != null && m.to < m.from).length;
    console.log(`     of those, ${up} go up and ${down} go down`);
    console.log(`\n    ${pad("machine", 12)}${padL("now", 12)}${padL("workbook", 12)}`);
    for (const m of wetMoves.slice(0, 12)) console.log(`    ${pad(m.code, 12)}${padL(m.from == null ? "—" : rs(m.from), 12)}${padL(rs(m.to), 12)}`);
    if (wetMoves.length > 12) console.log(`    … and ${wetMoves.length - 12} more`);
  }

  if (!APPLY) {
    console.log(`\n  (dry-run) nothing written. The impact on existing bills is NOT shown here —`);
    console.log(`  apply to a copy and regenerate to see it.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── write ─────────────────────────────────────────────────────────────────
  const actor = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } });

  let consWritten = 0, rateWritten = 0, cardsCreated = 0, priceWritten = 0;
  const kmHeldBack: string[] = [];

  // 1. consumption
  for (const c of cons) {
    const a = find(c.code, c.reg);
    if (!a || !a.rentalRate) continue;
    const meterBasis = a.meterType === "KM" ? "km" : a.meterType === "HOURS" ? "hr" : null;
    if (c.basis && meterBasis && c.basis !== meterBasis) continue; // held back, reported above
    await prisma.rentalRate.update({
      where: { assetId: a.id },
      data: {
        fuelConsEcon: c.econ,
        fuelConsTyp: c.typ,
        fuelConsHeavy: c.heavy,
        fuelConsBasis: c.basis,
      },
    });
    consWritten++;
  }

  // 2. fuel prices — a new dated row, never an edit of an old one. A price is a
  // fact about a day; rewriting it would rewrite what past issues cost.
  for (const [kind, rupees] of Object.entries(fuelPrices)) {
    if (rupees == null || !actor) continue;
    const cents = Math.round(rupees * 100);
    const current = await prisma.fuelPrice.findFirst({ where: { fuelKind: kind }, orderBy: { effectiveFrom: "desc" } });
    if (current && current.pricePerLitre === cents) continue;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    await prisma.fuelPrice.upsert({
      where: { fuelKind_effectiveFrom: { fuelKind: kind, effectiveFrom: from } },
      create: {
        fuelKind: kind, pricePerLitre: cents, effectiveFrom: from,
        source: "MANUAL", note: "Fleet_Rental_Prices_2026_fuel_v9 — Fuel Rates sheet", enteredById: actor.id,
      },
      update: { pricePerLitre: cents, note: "Fleet_Rental_Prices_2026_fuel_v9 — Fuel Rates sheet" },
    });
    priceWritten++;
  }

  // 3. rental rates, and everything onto the wet basis
  for (const p of prices) {
    const a = find(p.code, p.reg);
    if (!a) continue;

    // The workbook prices EVERY unit by the hour, road vehicles included —
    // BD-01 is listed at Rs 2,810/hour. This system bills road vehicles by the
    // kilometre, and writing an hourly figure into the per-km field multiplies
    // it by thousands: BD-01's July went from Rs 1.84M to Rs 17.0M in a trial
    // run before this guard existed. There is no per-km rental anywhere in the
    // workbook to use instead, so a road vehicle's rate is left alone and named
    // in the report.
    if (a.meterType === "KM") {
      kmHeldBack.push(a.code);
      // The basis still moves to wet — that part of the instruction is not in
      // dispute, only the figure.
      if (a.rentalRate) await prisma.rentalRate.update({ where: { assetId: a.id }, data: { defaultBasis: "w" } });
      continue;
    }

    const data: Record<string, unknown> = { defaultBasis: "w", sourceLabel: "Fleet_Rental_Prices_2026_fuel_v9" };
    if (p.wetCents != null) data.hrWCents = p.wetCents;
    if (p.dryCents != null) data.hrDCents = p.dryCents;

    if (a.rentalRate) {
      await prisma.rentalRate.update({ where: { assetId: a.id }, data });
      rateWritten++;
    } else {
      await prisma.rentalRate.create({ data: { assetId: a.id, equipType: "FLEET", ...data } as never });
      cardsCreated++;
    }
  }

  if (actor) {
    await prisma.auditLog.create({
      data: {
        actorId: actor.id, action: "UPDATE", entity: "RentalRate", entityId: "bulk",
        summary:
          `Imported Fleet_Rental_Prices_2026_fuel_v9: ${consWritten} consumption bands, ` +
          `${rateWritten} rate cards updated, ${cardsCreated} created, ${priceWritten} fuel price(s), all onto WET`,
        metaJson: JSON.stringify({
          file: FILE, consWritten, rateWritten, cardsCreated, priceWritten,
          fuelPrices, basisConflicts: basisConflicts.length, unmatched,
        }),
      },
    });
  }

  console.log(`\n  ✓ applied`);
  console.log(`    ${consWritten} consumption bands written`);
  console.log(`    ${rateWritten} rate cards updated, ${cardsCreated} created`);
  console.log(`    ${priceWritten} fuel price row(s) added`);
  console.log(`    every hourly machine written now bills WET by default`);
  if (kmHeldBack.length) {
    console.log(`
    HELD BACK — ${kmHeldBack.length} road vehicles kept their per-km rental.`);
    console.log(`    The workbook prices them by the hour and this system bills them by the`);
    console.log(`    kilometre; there is no per-km rate in the workbook to use. Their fuel`);
    console.log(`    consumption and the wet basis were still applied.`);
    console.log(`    ${kmHeldBack.slice(0,14).join(", ")}${kmHeldBack.length>14?" …":""}`);
  }
  console.log(`\n  Bills are NOT regenerated by this script — run scripts/regen-months.ts to see the effect.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
