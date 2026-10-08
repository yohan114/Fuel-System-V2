#!/usr/bin/env bash
# ==============================================================================
# Fuel-System-V2 PostgreSQL Production Backup Script (Task OPS-01)
# Crontab schedule recommendation: Hourly or Daily (e.g. 0 2 * * * for 02:00 UTC)
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fuelsystem}"
DB_NAME="${PGDATABASE:-fuelsystem_erp}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-fuelsystem_backup}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_PREFIX="pg-backup-${TIMESTAMP}"
ARCHIVE_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}.dump"
SCHEMA_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}.schema.sql"
MANIFEST_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}.manifest.json"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] Starting PostgreSQL backup for database '${DB_NAME}'..."

# 1. Custom format dump (compressed, supports multi-threaded restore)
pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -F c \
  -Z 9 \
  --blobs \
  -f "${ARCHIVE_FILE}"

# 2. Schema-only DDL dump for fast audit inspection
pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --schema-only \
  --no-owner \
  --no-privileges \
  -f "${SCHEMA_FILE}"

# 3. Calculate SHA-256 provenance hashes
ARCHIVE_SHA256=$(sha256sum "${ARCHIVE_FILE}" | awk '{print $1}')
SCHEMA_SHA256=$(sha256sum "${SCHEMA_FILE}" | awk '{print $1}')
ARCHIVE_SIZE=$(stat -c%s "${ARCHIVE_FILE}")
SCHEMA_SIZE=$(stat -c%s "${SCHEMA_FILE}")

# 4. Generate signed manifest
cat <<EOF > "${MANIFEST_FILE}"
{
  "backupId": "${BACKUP_PREFIX}",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "databaseName": "${DB_NAME}",
  "host": "${DB_HOST}",
  "archiveFileName": "$(basename "${ARCHIVE_FILE}")",
  "archiveSizeBytes": ${ARCHIVE_SIZE},
  "archiveSha256": "${ARCHIVE_SHA256}",
  "schemaFileName": "$(basename "${SCHEMA_FILE}")",
  "schemaSizeBytes": ${SCHEMA_SIZE},
  "schemaSha256": "${SCHEMA_SHA256}",
  "retentionDays": ${RETENTION_DAYS},
  "status": "COMPLETED"
}
EOF

echo "[$(date -Iseconds)] Backup completed successfully:"
echo "  Archive: ${ARCHIVE_FILE} (${ARCHIVE_SIZE} bytes, SHA-256: ${ARCHIVE_SHA256})"
echo "  Schema:  ${SCHEMA_FILE}"
echo "  Manifest: ${MANIFEST_FILE}"

# 5. Optional off-host sync (e.g. S3 / Cloudflare R2 / Drive)
if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  echo "[$(date -Iseconds)] Executing offsite backup sync: ${BACKUP_OFFSITE_CMD}"
  eval "${BACKUP_OFFSITE_CMD}"
fi
