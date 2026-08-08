import { describe, expect, it } from "vitest";
import { parseCeypetcoPrices, parseEffectiveDate, parsePriceCents } from "../src/lib/prices/ceypetco";

// Fixture mirroring the ceypetco.gov.lk/historical-prices table shape:
// WordPress table, header names the products, one row per revision (newest
// first), dd.mm.yyyy dates, comma-less two-decimal prices.
const PAGE = `
<html><body>
<h2>Historical Prices</h2>
<figure class="wp-block-table"><table>
<thead>
<tr><th>Effective Date &amp; Time</th><th>Petrol 92 Octane</th><th>Petrol 95 Octane Euro 4</th><th>Lanka Auto Diesel</th><th>Lanka Super Diesel Euro 4</th><th>Lanka Kerosene</th></tr>
</thead>
<tbody>
<tr><td>01.06.2026</td><td>294.00</td><td>341.00</td><td>277.00</td><td>325.00</td><td>185.00</td></tr>
<tr><td>01.05.2026</td><td>299.00</td><td>352.00</td><td>286.00</td><td>331.00</td><td>188.00</td></tr>
</tbody>
</table></figure>
</body></html>`;

describe("parseCeypetcoPrices", () => {
  it("reads the newest revision row with every product mapped", () => {
    const out = parseCeypetcoPrices(PAGE);
    expect(out.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-06-01");
    const by = Object.fromEntries(out.prices.map((p) => [p.code, p.priceCents]));
    expect(by.PETROL_92).toBe(29400);
    expect(by.PETROL_95).toBe(34100);
    expect(by.AUTO_DIESEL).toBe(27700);
    expect(by.SUPER_DIESEL).toBe(32500);
    expect(by.KEROSENE).toBe(18500);
  });

  it("tolerates missing columns and price cells (partial revisions)", () => {
    const html = `<table>
      <tr><th>Date</th><th>Lanka Auto Diesel</th><th>Petrol 92</th></tr>
      <tr><td>15-03-2026</td><td>—</td><td>—</td></tr>
      <tr><td>01-03-2026</td><td>301.00</td><td>region only</td></tr>
      <tr><td>01-02-2026</td><td>305.00</td><td>311.00</td></tr>
    </table>`;
    // First rows lack 2 parseable prices -> falls through to the Feb row.
    const out = parseCeypetcoPrices(html);
    expect(out.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(out.prices).toHaveLength(2);
  });

  it("returns empty for a page without a recognisable table", () => {
    expect(parseCeypetcoPrices("<html><body>maintenance</body></html>").prices).toEqual([]);
  });
});

describe("parseEffectiveDate", () => {
  it("handles the common Sri Lankan formats", () => {
    expect(parseEffectiveDate("01.06.2026")?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(parseEffectiveDate("31/12/2025 22:00")?.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(parseEffectiveDate("1st June 2026")?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(parseEffectiveDate("June 1, 2026")?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(parseEffectiveDate("n/a")).toBeNull();
  });
});

describe("parsePriceCents", () => {
  it("parses plain and comma prices, rejects junk", () => {
    expect(parsePriceCents("294.00")).toBe(29400);
    expect(parsePriceCents("Rs. 1,234.50")).toBe(123450);
    expect(parsePriceCents("—")).toBeNull();
    expect(parsePriceCents("999999")).toBeNull(); // sanity cap
  });
});
