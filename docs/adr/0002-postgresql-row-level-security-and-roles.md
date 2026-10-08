# ADR 0002: PostgreSQL Row-Level Security (RLS) & Role Hardening (RLS-01)

- **Status**: Accepted
- **Date**: 2026-10-08
- **Context**: Wave C (PostgreSQL Rehearsal) of Enterprise ERP Implementation Master Plan
- **Authors**: Core Engineering & Architecture Team
- **Dependencies**: PG-01, SEC-02, Master Plan Section 7

---

## 1. Context and Problem Statement

In the legacy SQLite implementation, all database operations executed under a single process with unrestricted read/write permissions. Authorization was enforced strictly in application software (Next.js Server Actions, REST routes, and export handlers).

While application-level authorization was hardened in `SEC-02` (enforcing role boundaries and resource-level scoping), an enterprise ERP architecture requires **defense-in-depth**:
1. **Accidental Cross-Site / Cross-Tenant Leakage**: If an application query omits a `WHERE project_id = ...` filter due to a bug or developer error, the database engine itself must reject or redact rows belonging to other sites.
2. **Privilege Separation (Least Privilege Principle)**: The runtime web application connection pool must never run as a database superuser or table owner. It must have zero DDL privileges (`CREATE TABLE`, `DROP`, `ALTER`) to prevent catastrophic schema tampering.
3. **Table Owner RLS Bypass**: By default, PostgreSQL table owners bypass Row-Level Security policies unless `FORCE ROW LEVEL SECURITY` is explicitly declared.
4. **Role Boundary Enforcement at the Engine Level**: Specialized roles such as `WORKSHOP` (fleet maintenance) must be prevented from reading billing documents (`bills`, `credit_notes`), reinforcing the business boundaries defined in `SEC-02`.
5. **Connection Pool Hygiene**: When using connection pools (e.g., PgBouncer or node-pg pools), session state must not leak across client requests.

---

## 2. Decision Drivers

- **Least-Privilege Database Roles**: Segregate migration/schema owner privileges (`fuelsystem_migrator`) from runtime web operations (`fuelsystem_app`).
- **Engine-Enforced Data Boundaries**: Enable and force RLS across all 37 database tables.
- **Transaction-Scoped Context (`SET LOCAL`)**: Bind tenant and user context strictly to the transaction boundary so that `COMMIT` or `ROLLBACK` guarantees automatic parameter cleanup.
- **Append-Only Immutability for Audit Records**: Enforce that `audit_logs` can be appended via `INSERT`, but cannot be modified via `UPDATE` or purged via `DELETE`.
- **Zero Performance Degradation**: RLS policies evaluate against stable helper functions and indexed foreign keys (`project_id`, `bulk_tank_id`, `user_id`).

---

## 3. Architecture Specification

### 3.1 Role Segregation

| Role Name | Type | Privileges | Prohibited Operations |
| :--- | :--- | :--- | :--- |
| `fuelsystem_migrator` | Schema Owner | `ALL PRIVILEGES` on schema `public`, table creation, migrations, indexing, triggers. | Not used by runtime web application connections. |
| `fuelsystem_app` | Runtime DML Role | `CONNECT`, `USAGE` on schema, `SELECT, INSERT, UPDATE, DELETE` on application tables, sequence usage. | `CREATE`, `DROP`, `ALTER` (DDL), superuser flags, `BYPASSRLS`. |

### 3.2 Session Parameter Contract

Transaction-local variables are established via `SET LOCAL` at the beginning of each database transaction:

```sql
SET LOCAL app.current_tenant_id = '<tenant-uuid>';
SET LOCAL app.current_user_id   = '<user-uuid>';
SET LOCAL app.current_user_role = '<ADMIN | USER | ALLOCATOR | WORKSHOP | SITE_PUMP>';
SET LOCAL app.current_project_id = '<project-uuid>';
SET LOCAL app.current_tank_id   = '<tank-uuid>';
SET LOCAL app.bypass_rls        = 'false';
```

### 3.3 RLS Policy Rules by Domain

#### A. Fuel Issues & Requests
- **`ADMIN`**: Full visibility and mutation.
- **`SITE_PUMP`**: Visibility and issuance limited to their assigned bulk tank (`bulk_tank_id`) or assigned project site (`project_id`).
- **`USER` / `ALLOCATOR`**: Scoped to their assigned project (`project_id`).
- **`WORKSHOP`**: Scoped to maintenance dispatches (`source_type = 'WORKSHOP'`) or their assigned site.
- **Immutability Guard**: `DELETE` is restricted to `ADMIN`. Physical deletion is disabled for runtime users; issues are cancelled via `STATUS = 'VOID'` or corrections.

#### B. Billing & Finance (`bills`, `bill_line_items`, `credit_notes`, `payments`)
- **`ADMIN`**: Full visibility, generation, and issuance authority.
- **`USER`**: Read-only visibility scoped to invoices where `project_id = current_setting('app.current_project_id')`.
- **`WORKSHOP` & `SITE_PUMP`**: **Deny All (`USING (false)`)**. Workshop and pump operators cannot view invoices, rates, or payment details.

#### C. Storage & Tanks (`bulk_tanks`, `tank_dips`, `bulk_requests`)
- **`SITE_PUMP`**: Can read and record dips for their assigned tank.
- **`USER`**: Can read tanks linked to their project.

#### D. Audit Trail Immutability (`audit_logs`)
- **`INSERT`**: Allowed for all authenticated transactions.
- **`UPDATE`**: Denied (`USING (false) WITH CHECK (false)`).
- **`DELETE`**: Denied (`USING (false)`).

---

## 4. Connection Pool Hygiene & Safety

Because application servers multiplex queries across connection pools, executing `SET session_var = '...'` could leave dirty state on connections reused by subsequent HTTP requests.

We resolve this by mandating `SET LOCAL` inside an explicit transaction:
```sql
BEGIN;
  SET LOCAL app.current_user_role = 'SITE_PUMP';
  SET LOCAL app.current_tank_id = 'cc7612c1-b235-4670-8284-45657874fec6';
  -- Business operations...
COMMIT; -- Context automatically reverts to NULL/default
```

If a connection is returned to the pool prematurely or encounters an error, `ROLLBACK` immediately clears all `SET LOCAL` variables. A fallback `RESET app.current_*` helper is provided for defensive programming.

---

## 5. Consequences

### Positive
- **Guaranteed Isolation**: Unscoped queries cannot leak data across sites or tenants.
- **Compliance with Financial Integrity Rules**: Invoices and payments are shielded from non-billing roles at the database engine level.
- **Append-Only Auditing**: `audit_logs` cannot be tampered with by runtime users even if application code is compromised.
- **DDL Protection**: The web runtime cannot drop or alter tables.

### Negative / Trade-offs
- Queries must be executed within transactions initialized with caller context.
- Administrative maintenance or background reconciliations must explicitly set `app.current_user_role = 'ADMIN'` or use `app.bypass_rls = 'true'`.
