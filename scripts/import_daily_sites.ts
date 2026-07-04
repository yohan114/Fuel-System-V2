import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import XLSX from "xlsx";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m) continue;
    let v = m[2] || "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v.trim();
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2, fbruary: 2,
  march: 3, mar: 3,
  april: 4, apr: 4, aprail: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12
};

function parseSheetMonthYear(sheetName: string, defaultYear: number): { month: number; year: number } | null {
  const clean = sheetName.trim().toLowerCase().replace(/[\s\-_]+/g, " ");
  const parts = clean.split(" ");
  let month: number | undefined;
  let year: number | undefined;

  for (const p of parts) {
    if (MONTHS[p] !== undefined) {
      month = MONTHS[p];
    } else {
      const yrMatch = p.match(/^(20\d{2})|(\d{2})$/);
      if (yrMatch) {
        const val = parseInt(p, 10);
        if (val >= 2000 && val <= 2099) {
          year = val;
        } else if (val >= 20 && val <= 99) {
          year = 2000 + val;
        }
      }
    }
  }

  if (month !== undefined) {
    return { month, year: year ?? defaultYear };
  }

  for (const [mName, mNum] of Object.entries(MONTHS)) {
    if (clean.includes(mName)) {
      month = mNum;
      break;
    }
  }
  if (month !== undefined) {
    const yrMatch = clean.match(/(20\d{2})|(\d{2})/);
    if (yrMatch) {
      const val = parseInt(yrMatch[0], 10);
      year = val >= 2000 ? val : 2000 + val;
    }
    return { month, year: year ?? defaultYear };
  }

  return null;
}

function mapTypeToCategory(type: string): string {
  const t = type.toLowerCase().trim();
  if (t.includes("compressor")) return "PE-AC";
  if (t.includes("grinder")) return "PE-AG";
  if (t.includes("saw")) return "PE-CS";
  if (t.includes("mixer")) return "PE-CM";
  if (t.includes("pump") || t.includes("water pump")) return "PE-EWP";
  if (t.includes("generator") || t.includes("genaretor") || t.includes("gen")) return "PE-GEN";
  if (t.includes("light")) return "PE-LP";
  if (t.includes("vibrator")) return "PE-PCV";
  if (t.includes("hammer") || t.includes("breaker")) return "PE-RH";
  if (t.includes("submersible")) return "PE-SP";
  if (t.includes("welding")) return "PE-WLD";
  
  if (t.includes("excavator") || (/\b\d{2,3}\b/.test(t) && t.includes("ex"))) return "HEX";
  if (t.includes("backhoe")) return "LB";
  if (t.includes("skid")) return "SL";
  if (t.includes("wheel loader") || t.includes("loader")) return "LD";
  if (t.includes("roller") || t.includes("compactor")) return "VR";
  if (t.includes("grader")) return "MG";
  if (t.includes("crane")) return "CR";
  if (t.includes("boom")) return "BM";
  if (t.includes("tipper") || t.includes("dump") || t.includes("3 cube") || t.includes("2 cube") || t.includes("1 cube")) return "DT";
  if (t.includes("mixer")) return "TM";
  if (t.includes("forklift") || t.includes("fork lift")) return "FL";
  if (t.includes("diesel bowser")) return "DB";
  if (t.includes("water bowser")) return "WB";
  if (t.includes("bowser") || t.includes("tanker")) return "DB";
  if (t.includes("crew")) return "HCC";
  if (t.includes("double cab") || t.includes("d/cab")) return "DC";
  if (t.includes("single cab") || t.includes("s/cab")) return "SC";
  if (t.includes("van")) return "PV";
  if (t.includes("tractor")) return "FT";
  if (t.includes("jeep")) return "DC";
  
  return "HEX";
}

const stripCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "");
const monthStartDate = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
function monthEndDate(y: number, m: number) {
  const d = new Date(y, m, 0);
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00+05:30`);
}
const toFloat = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };

async function main() {
  console.log("Importing Daily Site logs (Avissawella / Marawila)...\n");

  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found");
  const sysId = sysUser.id;

  // Pre-load all AUTO_DIESEL prices for dynamic lookup
  const allPrices = await prisma.fuelPrice.findMany({
    where: { fuelKind: "AUTO_DIESEL" },
    orderBy: { effectiveFrom: "asc" },
  });
  if (allPrices.length === 0) {
    throw new Error("No fuel prices found in database. Run import_fuel_prices first!");
  }
  function getPriceForDate(date: Date) {
    let selected = allPrices[0];
    for (const p of allPrices) {
      if (p.effectiveFrom <= date) {
        selected = p;
      } else {
        break;
      }
    }
    return selected;
  }

  // Pre-load assets
  const byCode = new Map<string, any>();
  const byReg = new Map<string, any>();
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true, regNo: true } });
  for (const a of assets) {
    byCode.set(stripCode(a.code), a);
    if (a.regNo) byReg.set(stripCode(a.regNo), a);
  }

  const SITES = [
    {
      code: "AVIS",
      name: "Avissawella Site",
      filename: "Avissawella site fuel report february,march,april,may 05.06.2026.xlsx",
      defaultYear: 2026
    },
    {
      code: "MARA",
      name: "Marawila Site",
      filename: "Marawila site.xlsx",
      defaultYear: 2025
    }
  ];

  // Idempotency: clear prior records for these sites
  const siteCodes = SITES.map(s => s.code);
  await prisma.fuelIssue.deleteMany({ where: { source: { in: siteCodes } } });
  await prisma.dailyCondition.deleteMany({
    where: {
      asset: {
        assignments: {
          some: {
            project: { code: { in: siteCodes } }
          }
        }
      }
    }
  });

  for (const site of SITES) {
    const excelPath = path.join(process.cwd(), site.filename);
    if (!fs.existsSync(excelPath)) {
      console.warn(`  ⚠ missing ${site.filename}`);
      continue;
    }

    const project = await prisma.project.upsert({
      where: { code: site.code },
      update: { name: site.name },
      create: { name: site.name, code: site.code }
    });

    // Password is generated randomly on first creation and printed once;
    // re-imports never touch credentials.
    const username = site.name;
    const existingUser = await prisma.user.findUnique({ where: { username } });
    const password = crypto.randomBytes(6).toString("base64url");
    await prisma.user.upsert({
      where: { username },
      update: { projectId: project.id, name: `${site.name} Site User`, active: true },
      create: { username, name: `${site.name} Site User`, role: "USER", passwordHash: bcrypt.hashSync(password, 10), projectId: project.id, createdById: sysId },
    });

    console.log(`\n── ${site.name} [${site.code}] — user="${username}" ${existingUser ? "(password unchanged)" : `password="${password}" (generated once — record it now)`}`);

    const wb = XLSX.readFile(excelPath);

    for (const sn of wb.SheetNames) {
      if (sn.toLowerCase().startsWith("sheet")) continue;
      const parsedPeriod = parseSheetMonthYear(sn, site.defaultYear);
      if (!parsedPeriod) continue;
      const { month, year } = parsedPeriod;

      const sheet = wb.Sheets[sn];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

      // Find header row index
      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const rowStr = JSON.stringify(rows[r] || "").toLowerCase();
        if (rowStr.includes("vehicle reg. no.") || rowStr.includes("vehicle reg no") || rowStr.includes("company code") || rowStr.includes("vehicle no")) {
          headerRowIdx = r;
          break;
        }
      }

      if (headerRowIdx < 0) {
        console.warn(`    ⚠ Header not found for sheet ${sn}`);
        continue;
      }

      const headers = rows[headerRowIdx];
      const daysRow = rows[headerRowIdx + 1] || [];

      const colReg = headers.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("vehicle reg"));
      const colCode = headers.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("company code"));
      const colType = headers.findIndex((h: any) => typeof h === "string" && (h.toLowerCase().includes("type of") || h.toLowerCase() === "type"));
      const colOpening = headers.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("opening"));
      const colClosing = headers.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("closing"));
      const colRate = headers.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("fuel rate"));

      // Detect daily issue columns (days 1 to 31)
      const dayCols: { day: number; colIdx: number }[] = [];
      for (let c = 0; c < daysRow.length; c++) {
        const val = parseInt(String(daysRow[c]), 10);
        if (!isNaN(val) && val >= 1 && val <= 31) {
          dayCols.push({ day: val, colIdx: c });
        }
      }

      console.log(`    Importing ${year}-${String(month).padStart(2, "0")} (${sn})`);

      for (let i = headerRowIdx + 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const rawReg = String(row[colReg] || "").trim();
        const rawCode = String(row[colCode] || "").trim();
        const type = String(row[colType] || "Vehicle").trim();

        let searchCode = rawCode || rawReg;
        if (!searchCode) {
          const cleanType = type.toLowerCase().trim();
          if (cleanType.includes("water pump") || cleanType.includes("waterpump")) {
            searchCode = "WATERPUMP";
          } else if (cleanType.includes("generator") || cleanType.includes("gen")) {
            searchCode = "GENERATOR";
          } else {
            continue;
          }
        }
        const cleanLower = searchCode.toLowerCase().trim();
        if (
          cleanLower.includes("total") || 
          cleanLower.includes("grand") ||
          cleanLower.includes("opening") || 
          cleanLower.includes("closing") ||
          cleanLower.includes("purchas") || 
          cleanLower.includes("consump") || 
          cleanLower.includes("prepared") ||
          cleanLower.includes("checked") ||
          cleanLower.includes("approved") ||
          cleanLower.includes("work") || 
          cleanLower.includes("cleaning") ||
          cleanLower.includes("stock") ||
          cleanLower.includes("balance") ||
          cleanLower.includes("shortage") ||
          cleanLower.includes("difference") ||
          cleanLower.includes("ecto") ||
          cleanLower.includes("dolphin") ||
          cleanLower.includes("mallawagedara") ||
          cleanLower.includes("wadakada") ||
          cleanLower.includes("..") ||
          cleanLower.includes("__") ||
          cleanLower.includes("---") ||
          cleanLower.trim() === ""
        ) {
          continue;
        }

        // Clean up the code to find matches
        const cleanCode = stripCode(searchCode);
        let asset = byCode.get(cleanCode) || byReg.get(cleanCode);

        // If not found, create new Asset
        if (!asset) {
          const catCode = mapTypeToCategory(type);
          let category = await prisma.category.findUnique({ where: { code: catCode } });
          if (!category) {
            // fallback if category not found
            category = await prisma.category.findFirst() as any;
          }
          const finalCode = searchCode.toUpperCase().trim();
          const newAsset = await prisma.asset.create({
            data: {
              code: finalCode,
              regNo: rawReg || null,
              typeLabel: type,
              meterType: category?.defaultMeterType || "HOURS",
              status: "ACTIVE",
              categoryId: category!.id,
              projectId: project.id
            }
          });
          asset = { id: newAsset.id, code: newAsset.code, meterType: newAsset.meterType };
          byCode.set(stripCode(newAsset.code), asset);
          if (newAsset.regNo) byReg.set(stripCode(newAsset.regNo), asset);
        } else {
          // Update project assignment
          await prisma.asset.update({
            where: { id: asset.id },
            data: { projectId: project.id }
          });
        }

        // Create AssetAssignment if not exists for this project and month
        const startD = monthStartDate(year, month);
        const endD = monthEndDate(year, month);
        const existingAssign = await prisma.assetAssignment.findFirst({
          where: { assetId: asset.id, projectId: project.id, startDate: startD }
        });
        if (!existingAssign) {
          await prisma.assetAssignment.create({
            data: {
              assetId: asset.id,
              projectId: project.id,
              startDate: startD,
              endDate: endD,
              note: `Daily Site Import`
            }
          });
        }

        // Import daily issues + working conditions
        const fuelRateVal = colRate >= 0 ? toFloat(row[colRate]) : 0;
        
        for (const dc of dayCols) {
          const litres = toFloat(row[dc.colIdx]);
          if (litres > 0) {
            const date = new Date(year, month - 1, dc.day, 0, 0, 0, 0);
            
            // Record working condition
            await prisma.dailyCondition.upsert({
              where: {
                assetId_logDate: {
                  assetId: asset.id,
                  logDate: date
                }
              },
              update: { status: "WORKING" },
              create: {
                assetId: asset.id,
                logDate: date,
                status: "WORKING",
                recordedById: sysId
              }
            });

            // Record fuel issue
            const activePrice = getPriceForDate(date);
            const ratePerLitre = fuelRateVal > 0 ? Math.round(fuelRateVal * 100) : activePrice.pricePerLitre;
            
            await prisma.fuelIssue.create({
              data: {
                assetId: asset.id,
                fuelKind: "AUTO_DIESEL",
                litres,
                pricePerLitre: ratePerLitre,
                totalCost: Math.round(litres * ratePerLitre),
                source: site.code,
                issueDate: date,
                issuedById: sysId,
                fuelPriceId: activePrice.id
              }
            });
          }
        }

        // Record opening / closing meters
        const openingMeter = colOpening >= 0 ? toFloat(row[colOpening]) : 0;
        const closingMeter = colClosing >= 0 ? toFloat(row[colClosing]) : 0;

        if (openingMeter > 0 || closingMeter > 0) {
          // opening
          await prisma.meterReading.create({
            data: {
              assetId: asset.id,
              readingType: asset.meterType,
              value: openingMeter,
              readingDate: monthStartDate(year, month),
              source: `SUMMARY_${site.code}_START`,
              recordedById: sysId
            }
          });
          // closing
          await prisma.meterReading.create({
            data: {
              assetId: asset.id,
              readingType: asset.meterType,
              value: closingMeter,
              readingDate: monthEndDate(year, month),
              source: `SUMMARY_${site.code}_END`,
              recordedById: sysId
            }
          });
        }
      }
    }
  }

  console.log("\n✓ Success! Daily site imports complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
