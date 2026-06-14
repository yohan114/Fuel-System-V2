import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

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
  const counts = await prisma.fuelIssue.groupBy({
    by: ["issuedById"],
    _count: {
      id: true
    }
  });

  console.log("=== DISPATCH COUNTS BY ISSUEDBYID ===");
  for (const c of counts) {
    const user = await prisma.user.findUnique({ where: { id: c.issuedById } });
    console.log(`User ID: "${c.issuedById}", Name: "${user?.name}", Username: "${user?.username}", Count: ${c._count.id}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
