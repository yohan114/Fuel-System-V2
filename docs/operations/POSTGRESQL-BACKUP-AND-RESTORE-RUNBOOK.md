# PostgreSQL Backup, Point-In-Time Recovery & Restore Runbook (OPS-01)

- **Target Database**: `fuelsystem_erp` (PostgreSQL 16+ LTS)
- **Status**: Production Operational Runbook
- **Reference**: Master Plan Section 11 (Migration Runbook), Section 12 (Deployment Plan), Section 13 (Release Gates)

---

## 1. Operational Objectives

| Metric | Target | Method |
| :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | `< 15 minutes` | Continuous WAL segment archiving to durable secondary storage. |
| **RTO (Recovery Time Objective)** | `< 30 minutes` | Automated parallel `pg_restore` from high-compression custom dumps (`-j 4`). |
| **Integrity Assurance** | `100% Data Preservation` | Cryptographic SHA-256 provenance checksums on every backup artifact + automated restore drills. |
| **Security Isolation** | `Least-Privilege Role` | Dedicated `fuelsystem_backup` role with read-only data access (`pg_read_all_data`); no superuser keys in backup scripts. |

---

## 2. Backup Architecture

### 2.1 Logical Snapshot Backups (Daily / Hourly)
Logical backups capture consistent point-in-time state without locking tables:
1. **Custom Compressed Dump (`.dump`)**:
   - Command: `pg_dump -Fc -Z 9 -f /var/backups/fuelsystem/pg-backup-YYYYMMDD-HHMMSS.dump`
   - Features: High compression, selective table restore, and multi-threaded parallel restoration via `pg_restore -j <N>`.
2. **Plaintext Schema DDL (`.schema.sql`)**:
   - Command: `pg_dump --schema-only -f /var/backups/fuelsystem/pg-backup-YYYYMMDD-HHMMSS.schema.sql`
   - Features: Human-readable DDL structure for git versioning and fast audit diffs.
3. **Signed Provenance Manifest (`.manifest.json`)**:
   - Cryptographic SHA-256 hashes of both archive and schema files, recording database version, file sizes, and creation timestamp.

### 2.2 Physical Continuous Archiving (WAL / PITR)
To achieve `< 15 min` RPO, configure PostgreSQL write-ahead log (WAL) archiving in `postgresql.conf`:

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/backups/fuelsystem/wal/%f && cp %p /var/backups/fuelsystem/wal/%f'
archive_timeout = 900 # Force WAL switch every 15 minutes
```

---

## 3. Scheduled Automation

### 3.1 Crontab Configuration
Add to the database host crontab (`crontab -e`):

```bash
# Nightly full backup at 02:00 UTC (07:30 Colombo time)
0 2 * * * /var/www/fuelsystem/scripts/ops/backup-postgresql.sh >> /var/log/fuelsystem-backup.log 2>&1

# Sync backups and WAL archives to off-site cloud storage every 30 minutes
*/30 * * * * aws s3 sync /var/backups/fuelsystem/ s3://fuelsystem-cold-backups/ --exclude "*.tmp"
```

### 3.2 Dedicated Backup Role Creation
```sql
CREATE ROLE fuelsystem_backup WITH LOGIN PASSWORD 'backup_secure_password';
GRANT CONNECT ON DATABASE fuelsystem_erp TO fuelsystem_backup;
GRANT pg_read_all_data TO fuelsystem_backup;
```

---

## 4. Disaster Recovery & Restoration Procedures

### 4.1 Scenario A: Disaster Recovery to Clean PostgreSQL Server

In the event of total server loss or host recreation:

1. **Provision Fresh PostgreSQL Instance**:
   Ensure PostgreSQL 16+ is installed and extensions (`uuid-ossp`, `btree_gist`, `citext`) are available.

2. **Create Target Database & Roles**:
   ```sql
   CREATE DATABASE fuelsystem_erp;
   CREATE ROLE fuelsystem_migrator WITH LOGIN PASSWORD 'migrator_secure_pass';
   CREATE ROLE fuelsystem_app WITH LOGIN PASSWORD 'app_secure_pass';
   GRANT ALL PRIVILEGES ON DATABASE fuelsystem_erp TO fuelsystem_migrator;
   ```

3. **Verify Archive Integrity Checksum**:
   ```bash
   sha256sum pg-backup-20261008-020000.dump
   # Compare output with sha256 in pg-backup-20261008-020000.manifest.json
   ```

4. **Execute Parallel Restore**:
   ```bash
   pg_restore \
     -h localhost \
     -U fuelsystem_migrator \
     -d fuelsystem_erp \
     --clean \
     --if-exists \
     --no-owner \
     --role=fuelsystem_migrator \
     -j 4 \
     --verbose \
     pg-backup-20261008-020000.dump
   ```

5. **Verify Row-Level Security & Role Grants**:
   Apply `scripts/migrations/pg/003_row_level_security.sql` if restoring from an earlier dump before RLS was activated.

---

### 4.2 Scenario B: Point-in-Time Recovery (PITR) to Specific Timestamp

Used when recovering from an accidental drop table or malicious data corruption at an exact time (e.g. `2026-10-08 11:45:00 UTC`):

1. **Stop PostgreSQL Service**:
   ```bash
   sudo systemctl stop postgresql
   ```

2. **Restore Base Backup**:
   Restore the latest physical base backup before the incident into `$PGDATA`.

3. **Configure Recovery Target in `postgresql.conf` / `postgresql.auto.conf`**:
   ```ini
   restore_command = 'cp /var/backups/fuelsystem/wal/%f %p'
   recovery_target_time = '2026-10-08 11:45:00 UTC'
   recovery_target_action = 'promote'
   ```

4. **Start PostgreSQL**:
   ```bash
   sudo systemctl start postgresql
   ```
   PostgreSQL will replay WAL records up to the exact target instant and promote itself to primary.

---

## 5. Automated Restore Drill Verification Checklist

Execute regular restore drills using `scripts/ops/pg_restore_drill.ts` against an isolated sandbox database (`fuelsystem_restore_drill`):

- [ ] **Archive Download & Checksum Verification**: SHA-256 matches manifest.
- [ ] **Database Restoration**: Completed with exit code 0 and zero unhandled errors.
- [ ] **Schema Parity**: All 37 ERP tables accounted for.
- [ ] **Stock Balance Invariant**: All storage tank physical balances non-negative (`balance >= 0`).
- [ ] **Issue Volume Invariant**: All active fuel issues strictly positive (`litres > 0`).
- [ ] **Financial Totals**: Invoices and bill line items balance exactly.
- [ ] **Audit Trail Continuity**: Non-zero immutable audit records present with actor IDs.
- [ ] **Row-Level Security**: RLS policies and `FORCE ROW LEVEL SECURITY` active.
- [ ] **Sandbox Cleanup**: Temporary drill database dropped.
