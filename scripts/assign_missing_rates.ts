import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== ASSIGNING RATE CARDS TO MISSING RATE ASSETS ===");

  // Find all distinct asset IDs in transaction tables
  const fuelAssetIds = await prisma.fuelIssue.findMany({ select: { assetId: true } });
  const meterAssetIds = await prisma.meterReading.findMany({ select: { assetId: true } });
  const condAssetIds = await prisma.dailyCondition.findMany({ select: { assetId: true } });

  const referencedIds = new Set<string>([
    ...fuelAssetIds.map(f => f.assetId),
    ...meterAssetIds.map(m => m.assetId),
    ...condAssetIds.map(c => c.assetId)
  ].filter(Boolean) as string[]);

  // Find referenced assets in DB that have no rates
  const assets = await prisma.asset.findMany({
    where: {
      id: { in: Array.from(referencedIds) },
      rentalRate: { is: null }
    }
  });

  console.log(`Found ${assets.length} active assets missing rates. Matching and assigning standard rates...`);

  // Fetch standard templates for cloning
  const doubleCabRate = await prisma.rentalRate.findFirst({
    where: { category: "Double Cab (Pickup)" }
  });
  const tipperRate = await prisma.rentalRate.findFirst({
    where: { category: "Dump Truck (Tipper)" }
  });
  const jcbRate = await prisma.rentalRate.findFirst({
    where: { category: "Backhoe Loader" }
  });
  const graderRate = await prisma.rentalRate.findFirst({
    where: { category: "Motor Grader" }
  });
  const tractorRate = await prisma.rentalRate.findFirst({
    where: { category: "Farm Tractor" }
  });
  const mixerRate = await prisma.rentalRate.findFirst({
    where: { category: "Truck Mixer" }
  });

  // Portable templates (from rate card)
  const portGenRate = { portDwCents: 700000, portDdCents: 350000 };     // 10 kVA Generator
  const portACRate = { portDwCents: 650000, portDdCents: 450000 };      // 10-15 HP Air Compressor
  const portPumpRate = { portDwCents: 380000, portDdCents: 260000 };    // 3" Petrol Water Pump

  let count = 0;

  for (const a of assets) {
    const code = a.code.toUpperCase().trim();
    const type = (a.typeLabel || "").toLowerCase().trim();

    let clonedRate: any = null;
    let categoryName = a.typeLabel || "Standard Rate";
    let equipType = "FLEET";

    if (code.includes("31-0724") || code.includes("59-1280") || code.includes("GJ-8775") || code.includes("ZA-6220") || type.includes("cab") || type.includes("jeep") || type.includes("vehicle")) {
      // Vehicle / Cab
      if (doubleCabRate) {
        clonedRate = {
          fuelQtyDefault: doubleCabRate.fuelQtyDefault,
          opRate: doubleCabRate.opRate,
          hrFwCents: doubleCabRate.hrFwCents,
          hrWCents: doubleCabRate.hrWCents,
          hrDCents: doubleCabRate.hrDCents,
          dyFwCents: doubleCabRate.dyFwCents,
          dyWCents: doubleCabRate.dyWCents,
          dyDCents: doubleCabRate.dyDCents,
          kmFwCents: doubleCabRate.kmFwCents,
          kmWCents: doubleCabRate.kmWCents,
          kmDCents: doubleCabRate.kmDCents
        };
        categoryName = "Double Cab (Pickup)";
        // Update asset meter type to KM
        await prisma.asset.update({ where: { id: a.id }, data: { meterType: "KM" } });
      }
    } else if (code.includes("LP-7183") || type.includes("tipper") || type.includes("tiper")) {
      // Tipper
      if (tipperRate) {
        clonedRate = {
          fuelQtyDefault: tipperRate.fuelQtyDefault,
          opRate: tipperRate.opRate,
          hrFwCents: tipperRate.hrFwCents,
          hrWCents: tipperRate.hrWCents,
          hrDCents: tipperRate.hrDCents,
          dyFwCents: tipperRate.dyFwCents,
          dyWCents: tipperRate.dyWCents,
          dyDCents: tipperRate.dyDCents,
          kmFwCents: tipperRate.kmFwCents,
          kmWCents: tipperRate.kmWCents,
          kmDCents: tipperRate.kmDCents
        };
        categoryName = "Dump Truck (Tipper)";
      }
    } else if (code.includes("LB-25") || type.includes("jcb") || type.includes("backhoe")) {
      // JCB
      if (jcbRate) {
        clonedRate = {
          fuelQtyDefault: jcbRate.fuelQtyDefault,
          opRate: jcbRate.opRate,
          hrFwCents: jcbRate.hrFwCents,
          hrWCents: jcbRate.hrWCents,
          hrDCents: jcbRate.hrDCents,
          dyFwCents: jcbRate.dyFwCents,
          dyWCents: jcbRate.dyWCents,
          dyDCents: jcbRate.dyDCents
        };
        categoryName = "Backhoe Loader";
      }
    } else if (code.includes("MG-5") || type.includes("grader")) {
      // Grader
      if (graderRate) {
        clonedRate = {
          fuelQtyDefault: graderRate.fuelQtyDefault,
          opRate: graderRate.opRate,
          hrFwCents: graderRate.hrFwCents,
          hrWCents: graderRate.hrWCents,
          hrDCents: graderRate.hrDCents
        };
        categoryName = "Motor Grader";
      }
    } else if (code.includes("RD-8851") || type.includes("tractor")) {
      // Farm Tractor
      if (tractorRate) {
        clonedRate = {
          fuelQtyDefault: tractorRate.fuelQtyDefault,
          opRate: tractorRate.opRate,
          hrFwCents: tractorRate.hrFwCents,
          hrWCents: tractorRate.hrWCents,
          hrDCents: tractorRate.hrDCents
        };
        categoryName = "Farm Tractor";
      }
    } else if (code.includes("ZB - 0050") || type.includes("mixer")) {
      // Truck Mixer
      if (mixerRate) {
        clonedRate = {
          fuelQtyDefault: mixerRate.fuelQtyDefault,
          opRate: mixerRate.opRate,
          hrFwCents: mixerRate.hrFwCents,
          hrWCents: mixerRate.hrWCents,
          hrDCents: mixerRate.hrDCents,
          dyFwCents: mixerRate.dyFwCents,
          dyWCents: mixerRate.dyWCents,
          dyDCents: mixerRate.dyDCents
        };
        categoryName = "Truck Mixer";
      }
    } else if (code.includes("WATERPUMP") || type.includes("pump")) {
      // Water Pump -> Portable Daily Rate
      clonedRate = {
        portDwCents: portPumpRate.portDwCents,
        portDdCents: portPumpRate.portDdCents
      };
      categoryName = "Water Pump";
      equipType = "PORTABLE";
    } else if (type.includes("generator") || type.includes("genaretor") || type.includes("gen") || code.includes("GE-") || code.includes("GE ")) {
      // Generator -> Portable Daily Rate
      clonedRate = {
        portDwCents: portGenRate.portDwCents,
        portDdCents: portGenRate.portDdCents
      };
      categoryName = "Generator";
      equipType = "PORTABLE";
    } else if (type.includes("compressor") || type.includes("compreshor") || code.includes("AC-") || code.includes("ACS-")) {
      // Air Compressor -> Portable Daily Rate
      clonedRate = {
        portDwCents: portACRate.portDwCents,
        portDdCents: portACRate.portDdCents
      };
      categoryName = "Air Compressor";
      equipType = "PORTABLE";
    }

    if (clonedRate) {
      // Update asset's type to PORTABLE if needed
      if (equipType === "PORTABLE") {
        await prisma.asset.update({
          where: { id: a.id },
          data: { meterType: "HOURS" } // standard for generators/pumps
        });
      }

      await prisma.rentalRate.create({
        data: {
          assetId: a.id,
          sourceLabel: `Auto-assigned standard ${categoryName} rate`,
          category: categoryName,
          equipType,
          ...clonedRate
        }
      });
      console.log(` - Assigned ${categoryName} rates to asset ${a.code} (EquipType: ${equipType})`);
      count++;
    } else {
      console.log(` - Skipping ${a.code} (Type: ${a.typeLabel}) - no standard mapping found`);
    }
  }

  console.log(`\n✓ Successfully assigned rates to ${count} assets.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
