import { FUEL_KINDS } from "../fuel-kinds";

// Fetch + parse the Ceypetco published price table
// (https://ceypetco.gov.lk/historical-prices/) and return the latest price per
// product. The page is a WordPress table whose header names the products
// (Petrol 92 / Petrol 95 Octane, Lanka Auto Diesel, Lanka Super Diesel,
// Kerosene) with one row per revision, newest first. Parsing is keyword-driven
// (FUEL_KINDS.ceypetcoMatch) so cosmetic wording changes don't break it; if
// the structure changes materially the cron surfaces a clear error instead of
// storing junk.

export interface CeypetcoPrice {
  code: string; // FUEL_KINDS code
  priceCents: number;
}

export interface CeypetcoLatest {
  effectiveFrom: Date | null;
  prices: CeypetcoPrice[];
}

// --- HTML → cell matrix -----------------------------------------------------

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html))) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(tr[1]))) cells.push(stripTags(cell[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// --- value parsing -----------------------------------------------------------

export function parsePriceCents(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n) || n <= 0 || n > 10000) return null; // sanity: Rs 0–10,000/L
  return Math.round(n * 100);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseEffectiveDate(raw: string): Date | null {
  // dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy
  let m = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  // dd Mon yyyy / Mon dd, yyyy
  m = raw.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const d = new Date(Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()] - 1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = raw.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})\s*(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const d = new Date(Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()] - 1, +m[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// --- table interpretation ----------------------------------------------------

// Pure: pull the newest price row out of the page HTML.
export function parseCeypetcoPrices(html: string): CeypetcoLatest {
  const rows = tableRows(html);

  // Find the header row: names at least two known products.
  let headerIdx = -1;
  let colOf: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const mapped: Record<string, number> = {};
    for (const kind of FUEL_KINDS) {
      const col = rows[i].findIndex((c) => kind.ceypetcoMatch.test(c));
      if (col >= 0) mapped[kind.code] = col;
    }
    if (Object.keys(mapped).length >= 2) {
      headerIdx = i;
      colOf = mapped;
      break;
    }
  }
  if (headerIdx < 0) return { effectiveFrom: null, prices: [] };

  const dateCol = rows[headerIdx].findIndex((c) => /date|effective|w\.?e\.?f/i.test(c));

  // First data row below the header with 2+ parseable prices = the latest revision.
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const prices: CeypetcoPrice[] = [];
    for (const [code, col] of Object.entries(colOf)) {
      const cents = col < row.length ? parsePriceCents(row[col]) : null;
      if (cents != null) prices.push({ code, priceCents: cents });
    }
    if (prices.length >= 2) {
      const effectiveFrom = dateCol >= 0 && dateCol < row.length ? parseEffectiveDate(row[dateCol]) : null;
      return { effectiveFrom, prices };
    }
  }
  return { effectiveFrom: null, prices: [] };
}

// --- live fetch ----------------------------------------------------------------

export const CEYPETCO_URL = "https://ceypetco.gov.lk/historical-prices/";

export async function fetchCeypetcoLatest(): Promise<CeypetcoLatest> {
  const res = await fetch(CEYPETCO_URL, {
    headers: {
      // The site rejects non-browser agents.
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Ceypetco fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const parsed = parseCeypetcoPrices(html);
  if (parsed.prices.length === 0) {
    throw new Error("Ceypetco page fetched but no price table recognised — page layout may have changed");
  }
  return parsed;
}
