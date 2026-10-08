# ADR 0001: PostgreSQL Schema & Mapping Design (PG-01)

- **Status**: Accepted / Ready for Rehearsal
- **Date**: 2026-10-08
- **Context**: Wave C (PostgreSQL Rehearsal) of Enterprise ERP Implementation Master Plan
- **Authors**: Core Engineering & Architecture Team
- **Dependencies**: DATA-01, DOM-01

---

## 1. Context and Problem Statement

The Fuel-System-V2 platform currently operates on SQLite (`better-sqlite3`). While SQLite has served well for local and single-server deployments, moving to an enterprise ERP foundation requires:
1. **High concurrency & strict isolation**: Eliminating file-level database write locks during intensive operations (e.g. bulk fuel imports, concurrent pump dispatches, monthly billing runs).
2. **Database-level domain constraints**: Moving beyond application-only guards by embedding atomic `CHECK` constraints (e.g. non-negative physical tank balances, positive fuel volumes, valid meter progressions) and temporal exclusion constraints (`EXCLUDE USING gist`) directly into the database engine.
3. **Data integrity and native typing**: Replacing string-encoded dates, boolean integers, and serialized JSON strings with native PostgreSQL `TIMESTAMPTZ`, `BOOLEAN`, `JSONB`, `NUMERIC`, `BIGINT`, and `UUID` types.
4. **Multi-tenant isolation and Row-Level Security (RLS)**: Supporting project/site scoping at the database level with restricted runtime connection roles, preventing unintended cross-site data leakage even in the event of application bugs.
5. **Clean Seam for Future .NET Backend**: Providing a database schema that cleanly maps to both Next.js/Prisma and the planned ASP.NET Core (.NET 10 LTS) modular monolith architecture.

---

## 2. Decision Drivers

- **Zero Data Loss & Strict Historical Parity**: All 37 existing models, historical fuel issues, meter outage history, billing revisions, and credit notes must map with 100% equivalence.
- **Physical Stock Balance Invariants**: A storage tank's balance can never fall below zero (`balance >= 0`), and transfer/issue quantities must always be strictly positive (`litres > 0`).
- **Temporal Consistency on Vehicle Postings**: An asset cannot be simultaneously assigned to two different projects on overlapping date spans (`EXCLUDE USING gist`).
- **Closed-Period Financial Protection**: Invoices that are `ISSUED` or `PAID` cannot have their underlying line items or fuel issues modified without an auditable revision or credit note.
- **Transactional Outbox for Event Publishing**: Core writes must atomically enqueue outbox messages for async tasks (maintenance sync, PDF generation, notification delivery) within the same database transaction.

---

## 3. Architecture Specification

### 3.1 Data Type Mapping Matrix

| SQLite Representation | PostgreSQL Native Type | Rationale |
| :--- | :--- | :--- |
| `TEXT` (UUID strings, e.g. `uuid()`) | `UUID` (`gen_random_uuid()`) | Native 16-byte binary storage; fast indexed lookups; index size reduced by 50%. |
| `TEXT` (ISO 8601 strings, e.g. `2026-10-08T...`) | `TIMESTAMPTZ` | Accurate microsecond precision with explicit timezone offsets (`Asia/Colombo`). |
| `REAL` / `FLOAT` (Litres, meter readings) | `NUMERIC(12, 2)` | Exact decimal precision; eliminates IEEE 754 floating-point rounding errors on volume balances. |
| `INTEGER` (Financial amounts, cents) | `BIGINT` | Strict integer arithmetic for Sri Lankan Rupee cents (e.g. `grandTotalCents`, `hireRateCents`). |
| `TEXT` (Serialized JSON strings) | `JSONB` | Binary JSON supporting GIN indexing, field querying, and structural schema validation. |
| `INTEGER` (0 / 1 boolean flags) | `BOOLEAN` | Native boolean type with 1-byte storage and tri-state logic support (`TRUE`, `FALSE`, `NULL`). |
| `TEXT` (Case-insensitive codes/usernames) | `CITEXT` / `VARCHAR(n)` | Deterministic case-insensitive uniqueness without relying on `COLLATE NOCASE`. |
| `BLOB` (Meter photos, documents) | `BYTEA` | Preserves inline binary storage compatibility with existing database backup workflows. |

---

### 3.2 Modular Monolith Schema Organization

The PostgreSQL schema will be partitioned into logical domain namespaces (schemas) or cleanly prefixed tables that map to the ASP.NET Core Modular Monolith structure:

```text
Database: fuelsystem_erp
├── Schema: core
│   ├── users
│   ├── projects
│   ├── categories
│   ├── settings
│   └── api_keys
├── Schema: fleet
│   ├── assets
│   ├── asset_assignments       (Temporal EXCLUDE constraint)
│   ├── vehicle_allocations
│   ├── daily_conditions
│   ├── meter_readings
│   └── meter_outages
├── Schema: fuel_inventory
│   ├── bulk_tanks              (CHECK balance >= 0)
│   ├── tank_dips
│   ├── bulk_requests
│   └── fuel_prices
├── Schema: fuel_operations
│   ├── fuel_requests
│   ├── fuel_issues             (Unique import_key, CHECK litres > 0)
│   ├── fuel_issue_corrections
│   └── billing_site_overrides
├── Schema: hire_billing
│   ├── rental_rates
│   ├── bills                   (Unique asset_id + year + month)
│   ├── bill_line_items
│   ├── bill_revisions
│   ├── payments
│   ├── credit_notes
│   ├── budgets
│   └── invoice_counters
├── Schema: maintenance
│   ├── pm_tasks
│   ├── service_intervals
│   ├── service_records
│   ├── service_items
│   ├── lubricants
│   ├── service_attachments
│   ├── filters
│   ├── filter_cross_refs
│   └── asset_filters
└── Schema: audit_infrastructure
    ├── audit_logs              (Append-only, immutable)
    └── outbox_messages         (Transactional Outbox queue)
```

---

### 3.3 Domain Invariants & Database Constraints

1. **Physical Tank Stock Protection**:
   ```sql
   ALTER TABLE bulk_tanks 
     ADD CONSTRAINT chk_tank_balance_non_negative CHECK (balance >= 0),
     ADD CONSTRAINT chk_tank_capacity_positive CHECK (capacity > 0);
   ```

2. **Fuel Dispense & Issue Constraints**:
   ```sql
   ALTER TABLE fuel_issues 
     ADD CONSTRAINT chk_fuel_issue_litres_positive CHECK (litres > 0),
     ADD CONSTRAINT chk_fuel_issue_cost_non_negative CHECK (total_cost >= 0),
     ADD CONSTRAINT chk_fuel_issue_price_non_negative CHECK (price_per_litre >= 0);
   ```

3. **Temporal Non-Overlapping Asset Assignments**:
   Using PostgreSQL's `btree_gist` extension, we prevent an asset from being posted to multiple projects at the same time:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;

   ALTER TABLE asset_assignments 
     ADD CONSTRAINT no_overlapping_asset_assignments 
     EXCLUDE USING gist (
       asset_id WITH =,
       daterange(start_date::date, COALESCE(end_date::date, 'infinity'::date), '[]') WITH &&
     );
   ```

4. **Financial Consistency & Closed Period Invariants**:
   ```sql
   ALTER TABLE bills
     ADD CONSTRAINT chk_bill_grand_total_consistent CHECK (grand_total_cents = subtotal_cents + tax_cents),
     ADD CONSTRAINT chk_bill_year_valid CHECK (year >= 2020),
     ADD CONSTRAINT chk_bill_month_valid CHECK (month BETWEEN 1 AND 12);

   ALTER TABLE payments
     ADD CONSTRAINT chk_payment_amount_positive CHECK (amount_cents > 0);

   ALTER TABLE credit_notes
     ADD CONSTRAINT chk_credit_note_amount_positive CHECK (amount_cents > 0);
   ```

---

### 3.4 Row-Level Security (RLS) Strategy

To enforce tenant and project isolation at the database layer (Master Plan Section 7):
1. **Connection Roles**:
   - `fuelsystem_migrator`: DDL schema owner, bypasses RLS for maintenance and migrations.
   - `fuelsystem_app`: Runtime application pool role with `NOBYPASSRLS`.
2. **Session Context Propagation**:
   The application sets context per-transaction:
   ```sql
   SELECT set_config('app.current_user_id', '...', true);
   SELECT set_config('app.current_user_role', 'SITE_PUMP', true);
   SELECT set_config('app.current_project_id', '...', true);
   ```
3. **Example Policy for Fuel Issues**:
   ```sql
   ALTER TABLE fuel_issues ENABLE ROW LEVEL SECURITY;

   CREATE POLICY fuel_issue_site_read_policy ON fuel_issues
     FOR SELECT TO fuelsystem_app
     USING (
       current_setting('app.current_user_role', true) IN ('ADMIN', 'ALLOCATOR', 'WORKSHOP')
       OR bulk_tank_id IN (
         SELECT id FROM bulk_tanks 
         WHERE project_id = current_setting('app.current_project_id', true)::uuid
       )
     );
   ```

---

### 3.5 Transactional Outbox Pattern (`outbox_messages`)

To decouple domain writes from asynchronous side-effects (service job syncing, PDF rendering, automated email distribution), an atomic outbox table is introduced:

```sql
CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ NULL,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL
);

CREATE INDEX idx_outbox_unprocessed ON outbox_messages (created_at) WHERE processed_at IS NULL;
```

---

### 3.6 EF Core & .NET Entity Mapping Specifications

For the planned ASP.NET Core (.NET 10 LTS) migration, entity configurations will inherit from `IEntityTypeConfiguration<T>` within each module. Key mappings include:
- `FuelIssueConfiguration`: Maps `Id`, `AssetId`, `Litres` (decimal), `TotalCost` (decimal), `ImportKey` (unique index), and concurrency tokens.
- `BulkTankConfiguration`: Maps `Balance` with check constraint, row versioning / `xmin` concurrency token.
- `AssetAssignmentConfiguration`: Maps `Daterange` and gist index.
- `BillConfiguration`: Maps `GrandTotalCents` (long), `Status` (enum conversion), unique index on `(AssetId, Year, Month)`.

---

## 4. Rehearsal and Migration Verification Strategy (PG-02 Ready)

1. **DDL Script Execution**: Ensure script runs idempotently on fresh PostgreSQL 16+ instance.
2. **Schema Parity Test Suite**: Vitest verification test `tests/pg-schema-parity.test.ts` verifying all models, fields, relations, and types against SQLite Prisma schema.
3. **Data Extract & Rehearsal**: Export SQLite data to JSON/CSV, import into PostgreSQL schema, and verify checksums, record counts, and tank closing balances.
