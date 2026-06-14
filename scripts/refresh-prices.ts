import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

async function refreshPrices() {
  console.log("Starting Ceypetco fuel price refresh...");

  // Load admin user to associate with price entries
  const adminUser = await prisma.user.findFirst({
    where: { username: "admin" },
  });
  if (!adminUser) {
    console.error("Error: Seed admin user not found. Run seed script first.");
    process.exit(1);
  }

  const url = "https://ceypetco.gov.lk/";
  
  // Best-effort headers to avoid Cloudflare/WAF blocks
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://www.google.com/",
    "Cache-Control": "no-cache",
  };

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log("Ceypetco page loaded successfully. Parsing prices...");

    // Best-effort extraction using regex pattern matches
    // Lanka Auto Diesel typically around Rs. 300 - 500
    // Lanka Super Diesel typically around Rs. 400 - 600
    const autoDieselMatch = html.match(/Lanka\s*Auto\s*Diesel[^]*?Rs\.?\s*(\d{3})/i);
    const superDieselMatch = html.match(/Lanka\s*Super\s*Diesel[^]*?Rs\.?\s*(\d{3})/i);

    let scrapedAutoPrice: number | null = null;
    let scrapedSuperPrice: number | null = null;

    if (autoDieselMatch) {
      scrapedAutoPrice = parseInt(autoDieselMatch[1], 10) * 100; // to cents
      console.log(`Parsed Lanka Auto Diesel: Rs. ${autoDieselMatch[1]}`);
    }
    if (superDieselMatch) {
      scrapedSuperPrice = parseInt(superDieselMatch[1], 10) * 100; // to cents
      console.log(`Parsed Lanka Super Diesel: Rs. ${superDieselMatch[1]}`);
    }

    if (!scrapedAutoPrice || !scrapedSuperPrice) {
      // Try fallback regexes
      const fallbackAuto = html.match(/Auto\s*Diesel[^]*?(?:Rs\.?|LKR)\s*(\d{3})/i);
      const fallbackSuper = html.match(/Super\s*Diesel[^]*?(?:Rs\.?|LKR)\s*(\d{3})/i);
      if (fallbackAuto && !scrapedAutoPrice) scrapedAutoPrice = parseInt(fallbackAuto[1], 10) * 100;
      if (fallbackSuper && !scrapedSuperPrice) scrapedSuperPrice = parseInt(fallbackSuper[1], 10) * 100;
    }

    if (!scrapedAutoPrice || !scrapedSuperPrice) {
      throw new Error("Could not parse fuel prices from Ceypetco HTML structure.");
    }

    // Write only-if-changed logic
    const today = new Date();
    today.setHours(0, 0, 0, 0); // truncate time

    let changesRecorded = 0;

    // Check Auto Diesel
    const latestAuto = await prisma.fuelPrice.findFirst({
      where: { fuelKind: "AUTO_DIESEL" },
      orderBy: { effectiveFrom: "desc" },
    });

    if (!latestAuto || latestAuto.pricePerLitre !== scrapedAutoPrice) {
      await prisma.fuelPrice.upsert({
        where: {
          fuelKind_effectiveFrom: {
            fuelKind: "AUTO_DIESEL",
            effectiveFrom: today,
          },
        },
        update: { pricePerLitre: scrapedAutoPrice, source: "CEYPETCO", enteredById: adminUser.id },
        create: { fuelKind: "AUTO_DIESEL", pricePerLitre: scrapedAutoPrice, effectiveFrom: today, source: "CEYPETCO", enteredById: adminUser.id, note: "Auto-scraped from Ceypetco website" },
      });
      changesRecorded++;
    }

    // Check Super Diesel
    const latestSuper = await prisma.fuelPrice.findFirst({
      where: { fuelKind: "SUPER_DIESEL" },
      orderBy: { effectiveFrom: "desc" },
    });

    if (!latestSuper || latestSuper.pricePerLitre !== scrapedSuperPrice) {
      await prisma.fuelPrice.upsert({
        where: {
          fuelKind_effectiveFrom: {
            fuelKind: "SUPER_DIESEL",
            effectiveFrom: today,
          },
        },
        update: { pricePerLitre: scrapedSuperPrice, source: "CEYPETCO", enteredById: adminUser.id },
        create: { fuelKind: "SUPER_DIESEL", pricePerLitre: scrapedSuperPrice, effectiveFrom: today, source: "CEYPETCO", enteredById: adminUser.id, note: "Auto-scraped from Ceypetco website" },
      });
      changesRecorded++;
    }

    // Log success
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        summary: `Refreshed Ceypetco prices: Auto Diesel = Rs. ${scrapedAutoPrice / 100}, Super Diesel = Rs. ${scrapedSuperPrice / 100}. Recorded ${changesRecorded} updates.`,
      },
    });

    console.log(`Ceypetco prices refreshed successfully. Recorded ${changesRecorded} updates.`);
  } catch (err: any) {
    console.warn("Failed to scrape Ceypetco website:", err.message);
    
    // Log graceful failure in the audit logs so administrators are notified
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        summary: `Ceypetco scraper failed gracefully: ${err.message}. System continues to use manual overrides.`,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

refreshPrices();
