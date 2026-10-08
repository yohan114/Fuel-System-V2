// PostgreSQL Automated Backup Engine (Task OPS-01 / Wave C & E)
// Target: PostgreSQL 16+ LTS
// Reference: Master Plan Section 12 (Deployment Plan) & Section 13 (Release Gates)

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface BackupOptions {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  outputDir?: string;
  retentionDays?: number;
  minimumRetainedCount?: number;
}

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  databaseName: string;
  host: string;
  archiveFileName: string;
  archiveSizeBytes: number;
  archiveSha256: string;
  schemaFileName: string;
  schemaSizeBytes: number;
  schemaSha256: string;
  retentionDays: number;
  status: "COMPLETED" | "FAILED";
}

/**
 * Calculates SHA-256 hash of a file on disk.
 */
export function calculateFileSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for checksum calculation: ${filePath}`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * Generates the pg_dump command arguments for a consistent custom-format archive.
 */
export function buildPgDumpArchiveCommand(options: BackupOptions, targetFilePath: string): string[] {
  const host = options.host || process.env.PGHOST || "localhost";
  const port = options.port || Number(process.env.PGPORT) || 5432;
  const db = options.database || process.env.PGDATABASE || "fuelsystem_erp";
  const user = options.username || process.env.PGUSER || "fuelsystem_backup";

  return [
    "pg_dump",
    "-h", host,
    "-p", port.toString(),
    "-U", user,
    "-d", db,
    "-F", "c",          // Custom format (compressed, supports parallel pg_restore)
    "-Z", "9",          // Maximum gzip compression
    "--blobs",          // Include binary large objects
    "--verbose",
    "-f", targetFilePath,
  ];
}

/**
 * Generates the pg_dump command arguments for a plaintext schema-only DDL dump.
 */
export function buildPgDumpSchemaCommand(options: BackupOptions, targetFilePath: string): string[] {
  const host = options.host || process.env.PGHOST || "localhost";
  const port = options.port || Number(process.env.PGPORT) || 5432;
  const db = options.database || process.env.PGDATABASE || "fuelsystem_erp";
  const user = options.username || process.env.PGUSER || "fuelsystem_backup";

  return [
    "pg_dump",
    "-h", host,
    "-p", port.toString(),
    "-U", user,
    "-d", db,
    "--schema-only",    // Only DDL structure, no data rows
    "--no-owner",
    "--no-privileges",
    "-f", targetFilePath,
  ];
}

/**
 * Applies retention rotation policy to local backup directory.
 * Prunes backups older than retentionDays, but guarantees minimumRetainedCount newest files survive.
 */
export function applyBackupRetentionPolicy(
  backupDir: string,
  retentionDays: number = 7,
  minimumRetainedCount: number = 3
): { deletedFiles: string[]; retainedFiles: string[] } {
  if (!fs.existsSync(backupDir)) {
    return { deletedFiles: [], retainedFiles: [] };
  }

  const cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  // Find all manifest files to determine backup sets
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("pg-backup-") && (f.endsWith(".dump") || f.endsWith(".sql") || f.endsWith(".json")))
    .map((fileName) => {
      const fullPath = path.join(backupDir, fileName);
      const stat = fs.statSync(fullPath);
      return {
        name: fileName,
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs); // Newest first

  // Group by backup prefix timestamp (pg-backup-YYYYMMDD-HHMMSS)
  const backupGroups = new Map<string, Array<{ name: string; fullPath: string; mtimeMs: number }>>();
  for (const file of files) {
    const match = file.name.match(/^(pg-backup-\d{8}-\d{6})/);
    const prefix = match ? match[1] : file.name;
    if (!backupGroups.has(prefix)) {
      backupGroups.set(prefix, []);
    }
    backupGroups.get(prefix)!.push(file);
  }

  const sortedPrefixes = Array.from(backupGroups.keys());
  const deletedFiles: string[] = [];
  const retainedFiles: string[] = [];

  sortedPrefixes.forEach((prefix, index) => {
    const group = backupGroups.get(prefix)!;
    const groupMtime = group[0].mtimeMs;

    // Prune if older than cutoff AND beyond minimumRetainedCount
    if (groupMtime < cutoffTimestamp && index >= minimumRetainedCount) {
      for (const item of group) {
        fs.unlinkSync(item.fullPath);
        deletedFiles.push(item.name);
      }
    } else {
      for (const item of group) {
        retainedFiles.push(item.name);
      }
    }
  });

  return { deletedFiles, retainedFiles };
}

/**
 * Creates and writes a signed backup manifest file.
 */
export function writeBackupManifest(
  manifestPath: string,
  manifestData: BackupManifest
): void {
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
}
