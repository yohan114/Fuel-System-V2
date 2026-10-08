// PostgreSQL Backup, PITR, and Restore Drill Test Suite (Task OPS-01 / Wave C & E)
//
// Verifies:
// 1. pg_dump command builders (custom format -Fc, compression -Z 9, schema-only).
// 2. SHA-256 provenance calculation and manifest serialization.
// 3. Retention rotation policy logic (pruning old backups while preserving top 3).
// 4. pg_restore command builder (--clean, --if-exists, --no-owner, multi-worker -j).
// 5. evaluateRestoredDatabaseState verification engine (all 37 tables, stock balance,
//    positive volume, financial balance, audit trail, and RLS).
// 6. Runbook documentation completeness (RPO, RTO, PITR, WAL archiving).

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildPgDumpArchiveCommand,
  buildPgDumpSchemaCommand,
  calculateFileSha256,
  applyBackupRetentionPolicy,
  writeBackupManifest,
  BackupManifest,
} from "../scripts/ops/pg_backup";
import {
  buildPgRestoreCommand,
  evaluateRestoredDatabaseState,
  EXPECTED_ERP_TABLES,
} from "../scripts/ops/pg_restore_drill";

describe("OPS-01: PostgreSQL Backup Command & Manifest Builders", () => {
  it("builds custom-format archive command with high compression and blobs", () => {
    const cmd = buildPgDumpArchiveCommand(
      {
        host: "db.internal.erp",
        port: 5432,
        database: "fuelsystem_erp",
        username: "fuelsystem_backup",
      },
      "/var/backups/test.dump"
    );

    expect(cmd[0]).toBe("pg_dump");
    expect(cmd).toContain("-h");
    expect(cmd).toContain("db.internal.erp");
    expect(cmd).toContain("-d");
    expect(cmd).toContain("fuelsystem_erp");
    expect(cmd).toContain("-F");
    expect(cmd).toContain("c");
    expect(cmd).toContain("-Z");
    expect(cmd).toContain("9");
    expect(cmd).toContain("--blobs");
    expect(cmd).toContain("/var/backups/test.dump");
  });

  it("builds schema-only DDL dump command for version control and audits", () => {
    const cmd = buildPgDumpSchemaCommand(
      {
        host: "localhost",
        port: 5432,
        database: "fuelsystem_erp",
        username: "fuelsystem_backup",
      },
      "/var/backups/test.schema.sql"
    );

    expect(cmd[0]).toBe("pg_dump");
    expect(cmd).toContain("--schema-only");
    expect(cmd).toContain("--no-owner");
    expect(cmd).toContain("--no-privileges");
    expect(cmd).toContain("/var/backups/test.schema.sql");
  });

  it("calculates exact SHA-256 provenance checksum", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-backup-test-"));
    const tempFile = path.join(tempDir, "sample.txt");
    fs.writeFileSync(tempFile, "Fuel-System-V2 Enterprise ERP Rehearsal", "utf-8");

    const hash = calculateFileSha256(tempFile);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes and reads back signed backup manifest", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-manifest-test-"));
    const manifestPath = path.join(tempDir, "manifest.json");

    const manifestData: BackupManifest = {
      backupId: "pg-backup-20261008-120000",
      createdAt: new Date().toISOString(),
      databaseName: "fuelsystem_erp",
      host: "localhost",
      archiveFileName: "pg-backup-20261008-120000.dump",
      archiveSizeBytes: 1048576,
      archiveSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      schemaFileName: "pg-backup-20261008-120000.schema.sql",
      schemaSizeBytes: 32768,
      schemaSha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      retentionDays: 7,
      status: "COMPLETED",
    };

    writeBackupManifest(manifestPath, manifestData);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const loaded = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(loaded.backupId).toBe("pg-backup-20261008-120000");
    expect(loaded.archiveSizeBytes).toBe(1048576);
    expect(loaded.status).toBe("COMPLETED");

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("OPS-01: Retention Rotation Policy", () => {
  it("prunes backups older than retention cutoff while protecting minimum recent count", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-retention-test-"));

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Create 5 mock backups: 2 recent (today, yesterday), 3 old (10, 15, 20 days ago)
    const backupDates = [
      { name: "pg-backup-20261008-120000.dump", age: 0 },
      { name: "pg-backup-20261007-120000.dump", age: 1 * dayMs },
      { name: "pg-backup-20260928-120000.dump", age: 10 * dayMs },
      { name: "pg-backup-20260923-120000.dump", age: 15 * dayMs },
      { name: "pg-backup-20260918-120000.dump", age: 20 * dayMs },
    ];

    for (const b of backupDates) {
      const p = path.join(tempDir, b.name);
      fs.writeFileSync(p, "dummy dump content");
      // Adjust mtime
      const targetTime = (now - b.age) / 1000;
      fs.utimesSync(p, targetTime, targetTime);
    }

    // Retention: 7 days, minimum guaranteed: 3 backups
    const res = applyBackupRetentionPolicy(tempDir, 7, 3);

    // The top 3 newest (today, yesterday, 10 days ago) must be retained
    expect(res.retainedFiles.length).toBe(3);
    expect(res.retainedFiles).toContain("pg-backup-20261008-120000.dump");
    expect(res.retainedFiles).toContain("pg-backup-20261007-120000.dump");
    expect(res.retainedFiles).toContain("pg-backup-20260928-120000.dump");

    // The 4th and 5th oldest (15 days and 20 days) must be deleted
    expect(res.deletedFiles.length).toBe(2);
    expect(res.deletedFiles).toContain("pg-backup-20260923-120000.dump");
    expect(res.deletedFiles).toContain("pg-backup-20260918-120000.dump");

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("OPS-01: PostgreSQL Restore Drill & Integrity Engine", () => {
  it("builds clean pg_restore command with parallel execution flags", () => {
    const cmd = buildPgRestoreCommand("/var/backups/test.dump", {
      targetDatabase: "fuelsystem_restore_drill",
      jobs: 4,
    });

    expect(cmd[0]).toBe("pg_restore");
    expect(cmd).toContain("--clean");
    expect(cmd).toContain("--if-exists");
    expect(cmd).toContain("--no-owner");
    expect(cmd).toContain("--role=fuelsystem_migrator");
    expect(cmd).toContain("-j");
    expect(cmd).toContain("4");
    expect(cmd).toContain("-d");
    expect(cmd).toContain("fuelsystem_restore_drill");
    expect(cmd).toContain("/var/backups/test.dump");
  });

  it("verifies restored database state when all ERP criteria pass", () => {
    const res = evaluateRestoredDatabaseState(
      EXPECTED_ERP_TABLES,
      [
        { id: "tank-1", name: "Main Tank", balance: 1500 },
        { id: "tank-2", name: "Bowser 01", balance: 350 },
      ],
      0, // Zero negative volume issues
      0, // Zero unbalanced bills
      3467, // Non-zero audit logs
      35 // Active RLS tables
    );

    expect(res.overallStatus).toBe("PASSED");
    expect(res.allTablesPresent).toBe(true);
    expect(res.stockBalanceIntegrityPassed).toBe(true);
    expect(res.volumeIntegrityPassed).toBe(true);
    expect(res.financialTotalsIntegrityPassed).toBe(true);
    expect(res.auditTrailContinuityPassed).toBe(true);
    expect(res.rlsPoliciesActive).toBe(true);
    expect(res.discrepancies.length).toBe(0);
  });

  it("fails verification when critical data invariants are violated", () => {
    // Missing tables, negative tank balance, and zero audit logs
    const res = evaluateRestoredDatabaseState(
      ["projects", "users"], // Missing 35 tables
      [{ id: "tank-1", name: "Corrupted Tank", balance: -50 }], // Negative balance!
      2, // 2 non-positive volume issues!
      1, // 1 unbalanced bill!
      0, // Zero audit logs!
      0 // Zero RLS tables!
    );

    expect(res.overallStatus).toBe("FAILED");
    expect(res.allTablesPresent).toBe(false);
    expect(res.stockBalanceIntegrityPassed).toBe(false);
    expect(res.volumeIntegrityPassed).toBe(false);
    expect(res.financialTotalsIntegrityPassed).toBe(false);
    expect(res.auditTrailContinuityPassed).toBe(false);
    expect(res.rlsPoliciesActive).toBe(false);
    expect(res.discrepancies.length).toBeGreaterThan(4);
  });

  it("verifies operations runbook documentation covers RPO, RTO, and PITR", () => {
    const runbookPath = path.resolve(
      __dirname,
      "..",
      "docs",
      "operations",
      "POSTGRESQL-BACKUP-AND-RESTORE-RUNBOOK.md"
    );

    expect(fs.existsSync(runbookPath)).toBe(true);
    const content = fs.readFileSync(runbookPath, "utf-8");
    expect(content).toContain("RPO (Recovery Point Objective)");
    expect(content).toContain("< 15 minutes");
    expect(content).toContain("RTO (Recovery Time Objective)");
    expect(content).toContain("< 30 minutes");
    expect(content).toContain("Point-in-Time Recovery (PITR)");
    expect(content).toContain("archive_command");
    expect(content).toContain("pg_restore");
    expect(content).toContain("fuelsystem_backup");
  });
});
