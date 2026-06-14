import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// 1. Load environment variables from .env
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    }
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Assigning imported historical data to 'Chamila Welarathne'...");

  // 1. Find Badalgama bulk tank
  const mainPump = await prisma.bulkTank.findFirst({
    where: { name: { contains: "Badalgama" } }
  });
  if (!mainPump) {
    console.error("Error: Badalgama main pump not found.");
    process.exit(1);
  }

  // 2. Create or find user Chamila Welarathne
  let chamila = await prisma.user.findUnique({
    where: { username: "chamila" }
  });

  if (!chamila) {
    console.log("User 'chamila' not found. Creating user 'Chamila Welarathne'...");
    const passwordHash = bcrypt.hashSync("chamila123", 10);
    chamila = await prisma.user.create({
      data: {
        username: "chamila",
        name: "Chamila Welarathne",
        passwordHash,
        role: "WORKSHOP",
        active: true,
        bulkTankId: mainPump.id,
      }
    });
    console.log(`Created user 'chamila' with ID: ${chamila.id}`);
  } else {
    console.log(`User 'chamila' already exists with ID: ${chamila.id}`);
  }

  // 3. Update all FuelIssue records belonging to the Badalgama bulk tank
  const updateIssuesResult = await prisma.fuelIssue.updateMany({
    where: {
      bulkTankId: mainPump.id,
    },
    data: {
      issuedById: chamila.id,
    }
  });
  console.log(`Updated ${updateIssuesResult.count} FuelIssue records to be issued by Chamila Welarathne.`);

  // 4. Update AuditLog records actorId for these fuel issues
  // Since audit logs are linked to User, let's update them
  const updateAuditResult = await prisma.auditLog.updateMany({
    where: {
      entity: "FuelIssue",
      action: "CREATE",
    },
    data: {
      actorId: chamila.id,
    }
  });
  console.log(`Updated ${updateAuditResult.count} AuditLog records actor to Chamila Welarathne.`);

  console.log("Assignment completed successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
