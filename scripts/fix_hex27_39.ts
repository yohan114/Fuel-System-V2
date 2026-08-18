import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== SWAPPING MODELS & RATES FOR HEX-27 & HEX-39 ===");

  const asset27 = await prisma.asset.findUnique({
    where: { code: "HEX-27" },
    include: { rentalRate: true }
  });

  const asset39 = await prisma.asset.findUnique({
    where: { code: "HEX-39" },
    include: { rentalRate: true }
  });

  if (!asset27 || !asset39) {
    console.error("Could not find both HEX-27 and HEX-39 in database!");
    return;
  }

  console.log(`Original HEX-27: ${asset27.model} | Rate Basis W: Rs. ${asset27.rentalRate?.hrWCents ? asset27.rentalRate.hrWCents / 100 : 0}`);
  console.log(`Original HEX-39: ${asset39.model} | Rate Basis W: Rs. ${asset39.rentalRate?.hrWCents ? asset39.rentalRate.hrWCents / 100 : 0}`);

  // 1. Swap Asset details (model, brand, typeLabel, yom)
  await prisma.asset.update({
    where: { id: asset27.id },
    data: {
      model: asset39.model,
      brand: asset39.brand,
      yom: asset39.yom,
    }
  });

  await prisma.asset.update({
    where: { id: asset39.id },
    data: {
      model: asset27.model,
      brand: asset27.brand,
      yom: asset27.yom,
    }
  });

  // 2. Swap RentalRate details
  if (asset27.rentalRate && asset39.rentalRate) {
    const rate27 = asset27.rentalRate;
    const rate39 = asset39.rentalRate;

    await prisma.rentalRate.update({
      where: { id: rate27.id },
      data: {
        sourceLabel: `Corrected R220LC-9S rates for HEX-27`,
        fuelQtyDefault: rate39.fuelQtyDefault,
        opRate: rate39.opRate,
        hrFwCents: rate39.hrFwCents,
        hrWCents: rate39.hrWCents,
        hrDCents: rate39.hrDCents,
        dyFwCents: rate39.dyFwCents,
        dyWCents: rate39.dyWCents,
        dyDCents: rate39.dyDCents,
        kmFwCents: rate39.kmFwCents,
        kmWCents: rate39.kmWCents,
        kmDCents: rate39.kmDCents,
        portDwCents: rate39.portDwCents,
        portDdCents: rate39.portDdCents,
        fuelConsEcon: rate39.fuelConsEcon,
        fuelConsTyp: rate39.fuelConsTyp,
        fuelConsBasis: rate39.fuelConsBasis,
      }
    });

    await prisma.rentalRate.update({
      where: { id: rate39.id },
      data: {
        sourceLabel: `Corrected E55W rates for HEX-39`,
        fuelQtyDefault: rate27.fuelQtyDefault,
        opRate: rate27.opRate,
        hrFwCents: rate27.hrFwCents,
        hrWCents: rate27.hrWCents,
        hrDCents: rate27.hrDCents,
        dyFwCents: rate27.dyFwCents,
        dyWCents: rate27.dyWCents,
        dyDCents: rate27.dyDCents,
        kmFwCents: rate27.kmFwCents,
        kmWCents: rate27.kmWCents,
        kmDCents: rate27.kmDCents,
        portDwCents: rate27.portDwCents,
        portDdCents: rate27.portDdCents,
        fuelConsEcon: rate27.fuelConsEcon,
        fuelConsTyp: rate27.fuelConsTyp,
        fuelConsBasis: rate27.fuelConsBasis,
      }
    });
  }

  console.log("\nSwap completed successfully!");

  const updated27 = await prisma.asset.findUnique({
    where: { code: "HEX-27" },
    include: { rentalRate: true }
  });
  const updated39 = await prisma.asset.findUnique({
    where: { code: "HEX-39" },
    include: { rentalRate: true }
  });

  console.log(`Updated HEX-27: ${updated27?.model} | Rate Basis W: Rs. ${updated27?.rentalRate?.hrWCents ? updated27.rentalRate.hrWCents / 100 : 0}`);
  console.log(`Updated HEX-39: ${updated39?.model} | Rate Basis W: Rs. ${updated39?.rentalRate?.hrWCents ? updated39.rentalRate.hrWCents / 100 : 0}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
