// ============================================================================
// PG-02 Rehearsal: SQLite Dataset Exporter & Provenance Generator
// Extracts all tables from SQLite into typed JSON datasets with SHA-256 checksums
// ============================================================================

import Database from "better-sqlite3";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { liveDbPath } from "../../src/lib/db-path";

export interface ExportManifest {
  sourceDbPath: string;
  sourceDbSizeBytes: number;
  exportedAt: string;
  overallSha256: string;
  totalTables: number;
  totalRows: number;
  tables: Record<string, { rowCount: number; sha256: string }>;
}

export function exportSqliteDataset(
  dbFilePath: string = liveDbPath(),
  outputDir: string = path.resolve(process.cwd(), "data", "rehearsal")
): ExportManifest {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const db = new Database(dbFilePath, { readonly: true });
  const stat = fs.statSync(dbFilePath);

  // Exclude internal SQLite and Prisma migration tables
  const tableRows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name"
    )
    .all() as { name: string }[];

  const manifest: ExportManifest = {
    sourceDbPath: dbFilePath,
    sourceDbSizeBytes: stat.size,
    exportedAt: new Date().toISOString(),
    overallSha256: "",
    totalTables: tableRows.length,
    totalRows: 0,
    tables: {},
  };

  const tableHashes: string[] = [];

  for (const { name } of tableRows) {
    const rows = db.prepare(`SELECT * FROM "${name}"`).all();
    const jsonStr = JSON.stringify(rows);
    const tableHash = crypto.createHash("sha256").update(jsonStr).digest("hex");

    fs.writeFileSync(path.join(outputDir, `${name}.json`), jsonStr, "utf-8");

    manifest.tables[name] = {
      rowCount: rows.length,
      sha256: tableHash,
    };

    manifest.totalRows += rows.length;
    tableHashes.push(`${name}:${tableHash}`);
  }

  manifest.overallSha256 = crypto
    .createHash("sha256")
    .update(tableHashes.join(";"))
    .digest("hex");

  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  return manifest;
}

// Direct execution CLI entrypoint
if (require.main === module || process.argv[1]?.includes("export_sqlite_dataset")) {
  console.log("=== EXPORTING SQLITE DATASET FOR PG-02 REHEARSAL ===");
  const manifest = exportSqliteDataset();
  console.log(`Source DB:       ${manifest.sourceDbPath} (${(manifest.sourceDbSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`Exported At:     ${manifest.exportedAt}`);
  console.log(`Total Tables:    ${manifest.totalTables}`);
  console.log(`Total Records:   ${manifest.totalRows}`);
  console.log(`Dataset SHA-256: ${manifest.overallSha256}`);
  console.log("Export manifest generated successfully.");
}
