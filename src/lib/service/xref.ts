// Filter cross-reference engine (merged from the Service Record system's
// xref.js). Turns every filter's OEM / HIFI number and free-text cross-reference
// string into a normalized, searchable index (FilterCrossRef). You can then
// type ANY part number — from any brand — and get back the matching filter(s)
// with their equivalents, a price estimate, and the machines that use them.

import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

// Known filter / OEM brands (best-effort labelling only).
const BRANDS_1 = new Set([
  "sakura", "vic", "fleetguard", "baldwin", "donaldson", "mann", "mahle", "bosch", "wix",
  "ryco", "hengst", "racor", "hifi", "jcb", "toyota", "mico", "tata", "komatsu", "fram",
  "purolator", "kubota", "perkins", "caterpillar", "cat", "volvo", "hitachi", "hyundai",
  "doosan", "isuzu", "mitsubishi", "nissan", "denso", "napa", "parker", "deutz", "cummins",
  "yanmar", "jason", "jeson", "leypack", "leyparts", "kfc", "osc", "osk", "sanra", "sara",
  "august", "cypak", "xenon", "iveco", "bobcat", "js", "ufi", "sofima", "tecfil", "asas",
  "kolbenschmidt", "filtron", "wesfil", "ashika", "blueprint", "febi", "champion", "crosland",
]);
const BRANDS_2 = new Set([
  "ashok leyland", "sf filter", "mico bosch", "mann hummel", "mann filter", "donaldson blue",
  "ec genuine", "genuine parts", "fleet guard",
]);

const clean = (t: string) => (t || "").replace(/[(),.;:]+$/g, "").replace(/^[(),.;:]+/g, "").trim();
const lower = (t: string) => clean(t).toLowerCase();

// Normalized key used for matching (uppercase, alphanumeric only).
export function normalize(s: string | null | undefined): string {
  return (s || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Does a token look like a part number? (has a digit, >= 3 useful chars)
export function isPartNumber(token: string): boolean {
  const t = clean(token);
  if (!/[0-9]/.test(t)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/.]*$/.test(t)) return false;
  if (normalize(t).length < 3) return false;
  if (/^(19|20)\d{2}$/.test(t)) return false; // bare year
  return true;
}

const SEPARATORS = new Set([
  "/", "\\", "&", "-", "or", "and", "to", "equivalent", "eq", "aka",
  "series", "type", "genuine", "standard", "set", "kit", "replaces", "replacement", "ref",
]);

function titleBrand(b: string): string {
  return b.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface RefPair { brand: string; partNumber: string; }

function dedupePairs(pairs: RefPair[]): RefPair[] {
  const seen = new Set<string>();
  const out: RefPair[] = [];
  for (const p of pairs) {
    const key = normalize(p.partNumber);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// Parse a free-text cross-reference string into {brand, partNumber} pairs.
export function parseCrossRefText(text: string | null | undefined): RefPair[] {
  if (!text) return [];
  const tokens = String(text).split(/[\s,]+/).filter(Boolean);
  const out: RefPair[] = [];
  let currentBrand = "";
  for (let i = 0; i < tokens.length; i++) {
    const oneRaw = clean(tokens[i]);
    if (!oneRaw) continue;
    const one = lower(tokens[i]);
    const two = i + 1 < tokens.length ? `${one} ${lower(tokens[i + 1])}` : null;

    if (two && BRANDS_2.has(two)) { currentBrand = titleBrand(two); i++; continue; }
    if (BRANDS_1.has(one)) { currentBrand = titleBrand(one); continue; }
    if (isPartNumber(oneRaw)) { out.push({ brand: currentBrand, partNumber: oneRaw }); continue; }
  }
  return dedupePairs(out);
}

// ---------------------------------------------------------------------------
// Build / rebuild the auto part of the index from FilterCatalog. Manual rows
// (source='manual') are preserved.
// ---------------------------------------------------------------------------
export async function rebuildIndex(): Promise<{ filters: number; indexed: number }> {
  const filters = await prisma.filterCatalog.findMany({
    select: { id: true, oemPartNumber: true, hifiPartNumber: true, crossRefText: true },
  });

  await prisma.filterCrossRef.deleteMany({ where: { source: "auto" } });

  const rows: Prisma.FilterCrossRefCreateManyInput[] = [];
  for (const f of filters) {
    const seen = new Set<string>();
    const push = (pn: string, brand: string, type: string) => {
      const npn = normalize(pn);
      if (!npn || npn.length < 3) return;
      const key = npn + "|" + type;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ catalogId: f.id, brand: brand || "", partNumber: clean(pn), normalizedPN: npn, refType: type, source: "auto" });
    };
    if (f.oemPartNumber) push(f.oemPartNumber, "", "oem");
    if (f.hifiPartNumber) push(f.hifiPartNumber, "HIFI", "hifi");
    for (const p of parseCrossRefText(f.crossRefText)) push(p.partNumber, p.brand, "cross");
  }

  // Insert in chunks to keep the statement size reasonable.
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.filterCrossRef.createMany({ data: rows.slice(i, i + 1000) });
  }
  return { filters: filters.length, indexed: rows.length };
}

export async function indexStats() {
  const [totalCrossRefs, manualCrossRefs, filters, distinct] = await Promise.all([
    prisma.filterCrossRef.count(),
    prisma.filterCrossRef.count({ where: { source: "manual" } }),
    prisma.filterCatalog.count(),
    prisma.filterCrossRef.findMany({ distinct: ["catalogId"], select: { catalogId: true } }),
  ]);
  return { totalCrossRefs, manualCrossRefs, filters, filtersWithRefs: distinct.length };
}

export interface XrefVehicle { code: string; brand: string | null; model: string | null; regNo: string | null; }
export interface XrefResult {
  catalogId: string;
  category: string | null;
  description: string | null;
  oem: string | null;
  hifi: string | null;
  crossText: string | null;
  matchedPN: string;
  equivalents: Record<string, { id: string; partNumber: string; type: string; source: string }[]>;
  equivalentCount: number;
  vehicles: XrefVehicle[];
  vehicleCount: number;
  price: { code: string; description: string | null; unitCents: number } | null;
}

// Build a rich result object for one filter (equivalents, vehicles, price).
export async function describeFilter(catalogId: string, matchedPN = ""): Promise<XrefResult | null> {
  const f = await prisma.filterCatalog.findUnique({ where: { id: catalogId } });
  if (!f) return null;

  const refs = await prisma.filterCrossRef.findMany({
    where: { catalogId },
    select: { id: true, brand: true, partNumber: true, normalizedPN: true, refType: true, source: true },
  });
  // Order: OEM first, then HIFI, then by brand.
  refs.sort((a, b) => {
    const rank = (t: string) => (t === "oem" ? 0 : t === "hifi" ? 1 : 2);
    return rank(a.refType) - rank(b.refType) || a.brand.localeCompare(b.brand);
  });

  const equivalents: XrefResult["equivalents"] = {};
  for (const r of refs) {
    const label = r.refType === "oem" ? "OEM" : r.brand || (r.refType === "hifi" ? "HIFI" : "Other");
    (equivalents[label] = equivalents[label] || []).push({ id: r.id, partNumber: r.partNumber, type: r.refType, source: r.source });
  }

  // Price: any equivalent normalized code found in the price book.
  const norms = [...new Set(refs.map((r) => r.normalizedPN).filter(Boolean))];
  let price: XrefResult["price"] = null;
  if (norms.length) {
    const pr = await prisma.filterPrice.findFirst({
      where: { normalizedCode: { in: norms }, unitPriceCents: { gt: 0 } },
      select: { supplierCode: true, description: true, unitPriceCents: true },
    });
    if (pr) price = { code: pr.supplierCode, description: pr.description, unitCents: pr.unitPriceCents };
  }

  // Machines that use this filter — match link EC codes to live assets.
  const links = await prisma.filterVehicleLink.findMany({ where: { catalogId }, select: { ec: true } });
  const ecs = [...new Set(links.map((l) => l.ec.toUpperCase()).filter(Boolean))];
  let vehicles: XrefVehicle[] = [];
  if (ecs.length) {
    vehicles = await prisma.asset.findMany({
      where: { code: { in: ecs } },
      select: { code: true, brand: true, model: true, regNo: true },
      orderBy: { code: "asc" },
      take: 60,
    });
  }

  return {
    catalogId: f.id,
    category: f.filterCategory,
    description: f.description,
    oem: f.oemPartNumber,
    hifi: f.hifiPartNumber,
    crossText: f.crossRefText,
    matchedPN,
    equivalents,
    equivalentCount: refs.length,
    vehicles,
    vehicleCount: vehicles.length,
    price,
  };
}

// Search: type any filter / part number → matching filters (exact → prefix → contains).
export async function search(q: string, limit = 25) {
  const nq = normalize(q);
  if (nq.length < 2) return { query: q, normalized: nq, count: 0, shown: 0, exactMatches: 0, results: [] as XrefResult[], note: "Type at least 2 characters." };

  const sel = { catalogId: true, partNumber: true } as const;
  const [exact, prefix, contains] = await Promise.all([
    prisma.filterCrossRef.findMany({ where: { normalizedPN: nq }, select: sel, take: 200 }),
    prisma.filterCrossRef.findMany({ where: { normalizedPN: { startsWith: nq }, NOT: { normalizedPN: nq } }, select: sel, take: 200 }),
    nq.length >= 3
      ? prisma.filterCrossRef.findMany({ where: { normalizedPN: { contains: nq }, NOT: { normalizedPN: { startsWith: nq } } }, select: sel, take: 200 })
      : Promise.resolve([] as { catalogId: string; partNumber: string }[]),
  ]);

  const order: string[] = [];
  const matchedPN = new Map<string, string>();
  for (const row of [...exact, ...prefix, ...contains]) {
    if (!matchedPN.has(row.catalogId)) {
      matchedPN.set(row.catalogId, row.partNumber);
      order.push(row.catalogId);
    }
  }

  const results = (await Promise.all(order.slice(0, limit).map((id) => describeFilter(id, matchedPN.get(id) || "")))).filter(
    (r): r is XrefResult => r != null
  );
  return { query: q, normalized: nq, count: order.length, shown: results.length, exactMatches: exact.length, results };
}

// Manual cross-reference management.
export async function addManualRef({ catalogId, brand = "", partNumber, note = "" }: { catalogId: string; brand?: string; partNumber: string; note?: string }) {
  const pn = clean(partNumber);
  const npn = normalize(pn);
  if (!npn || npn.length < 2) throw new Error("A valid part number is required");
  if (!catalogId) throw new Error("A filter is required");
  const filter = await prisma.filterCatalog.findUnique({ where: { id: catalogId }, select: { id: true } });
  if (!filter) throw new Error("Filter not found");
  const dup = await prisma.filterCrossRef.findFirst({ where: { catalogId, normalizedPN: npn }, select: { id: true } });
  if (dup) throw new Error("That cross-reference already exists for this filter");
  const rec = await prisma.filterCrossRef.create({
    data: { catalogId, brand: String(brand || ""), partNumber: pn, normalizedPN: npn, refType: "manual", note: String(note || ""), source: "manual" },
  });
  return rec.id;
}

export async function deleteManualRef(xrefId: string) {
  const row = await prisma.filterCrossRef.findUnique({ where: { id: xrefId }, select: { source: true } });
  if (!row) throw new Error("Cross-reference not found");
  if (row.source !== "manual") throw new Error("Only manually-added cross-references can be deleted");
  await prisma.filterCrossRef.delete({ where: { id: xrefId } });
}

// All filters used by one fleet vehicle (by E&C code), each with its equivalents.
export async function filtersForVehicle(ec: string): Promise<XrefResult[]> {
  const links = await prisma.filterVehicleLink.findMany({ where: { ec: ec.toUpperCase() }, select: { catalogId: true }, distinct: ["catalogId"] });
  const results = await Promise.all(links.map((l) => describeFilter(l.catalogId)));
  return results.filter((r): r is XrefResult => r != null);
}
