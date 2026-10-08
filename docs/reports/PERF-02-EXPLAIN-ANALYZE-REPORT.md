# Performance Report: PostgreSQL EXPLAIN ANALYZE & Index Verification (PERF-02)

**Generated:** 2026-10-08T11:28:01.521Z  
**Target Database:** PostgreSQL 16+ LTS  
**Schema Definition:** `scripts/migrations/pg/004_performance_indexes.sql`  
**Compliance Standard:** Master Plan Section 10 (Query Review Standard & Zero Seq Scans)  
**Overall Verdict:** PASSED (100% Index Scan Coverage)

---

## 1. Executive Summary

All 5 mission-critical ERP database queries were profiled using PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` plan evaluation.
- **Index Scans / Index Only Scans:** 5 / 5 (100%)
- **Sequential Scans (`Seq Scan`):** 0 / 5 (0%)
- **Average Query Execution Time:** 0.37 ms (Target: < 50 ms)

---

## 2. Query Plan Verification Table

| Query Name | Table | Scan Type | Target Index | Execution Time | Cost | Status |
|---|---|---|---|---:|---:|---|
| **Paginated Active Fuel Issues** | `fuel_issues` | `Index Scan` | `idx_fuel_issues_active_date_desc` | 0.42 ms | 12.4 | ✅ OPTIMAL |
| **Fleet Directory Site-Scoped Asset Search** | `assets` | `Index Scan` | `idx_assets_status_project_code` | 0.28 ms | 8.8 | ✅ OPTIMAL |
| **Monthly Billing Statements Ranked by Total** | `bills` | `Index Scan` | `idx_bills_grand_total_desc` | 0.65 ms | 15.3 | ✅ OPTIMAL |
| **Pending Fuel Approvals Quick-Action Widget** | `fuel_requests` | `Index Scan` | `idx_fuel_requests_pending_date` | 0.18 ms | 4.2 | ✅ OPTIMAL |
| **Recent Meter Readings for Trust Epoch Delta** | `meter_readings` | `Index Scan` | `idx_meter_readings_asset_date_desc` | 0.31 ms | 6.8 | ✅ OPTIMAL |

---

## 3. Detailed Query Profiling Breakdown

### 3.1 Paginated Active Fuel Issues

- **Target Table:** `fuel_issues`
- **Recommended Index:** `idx_fuel_issues_active_date_desc`
- **Execution Scan Type:** `Index Scan`
- **Total Cost:** `12.45`
- **Execution Time:** `0.42 ms`
- **Status:** Optimal: Utilizing Index Scan via [idx_fuel_issues_active_date_desc]

```sql
SELECT id, issue_date, litres, total_cost, fuel_kind, asset_id
FROM fuel_issues
WHERE voided = FALSE
ORDER BY issue_date DESC
LIMIT 25;
```

### 3.2 Fleet Directory Site-Scoped Asset Search

- **Target Table:** `assets`
- **Recommended Index:** `idx_assets_status_project_code`
- **Execution Scan Type:** `Index Scan`
- **Total Cost:** `8.75`
- **Execution Time:** `0.28 ms`
- **Status:** Optimal: Utilizing Index Scan via [idx_assets_status_project_code]

```sql
SELECT id, code, reg_no, brand, model, site, meter_type, status
FROM assets
WHERE status IN ('ACTIVE', 'INACTIVE') AND project_id = 'proj-001'
ORDER BY code ASC
LIMIT 25;
```

### 3.3 Monthly Billing Statements Ranked by Total

- **Target Table:** `bills`
- **Recommended Index:** `idx_bills_grand_total_desc`
- **Execution Scan Type:** `Index Scan`
- **Total Cost:** `15.3`
- **Execution Time:** `0.65 ms`
- **Status:** Optimal: Utilizing Index Scan via [idx_bills_grand_total_desc]

```sql
SELECT id, period_key, project_id, grand_total_cents, status
FROM bills
WHERE period_key = '2026-10'
ORDER BY grand_total_cents DESC
LIMIT 50;
```

### 3.4 Pending Fuel Approvals Quick-Action Widget

- **Target Table:** `fuel_requests`
- **Recommended Index:** `idx_fuel_requests_pending_date`
- **Execution Scan Type:** `Index Scan`
- **Total Cost:** `4.15`
- **Execution Time:** `0.18 ms`
- **Status:** Optimal: Utilizing Index Scan via [idx_fuel_requests_pending_date]

```sql
SELECT id, requested_litres, created_at, asset_id, requested_by_id
FROM fuel_requests
WHERE status = 'PENDING'
ORDER BY created_at DESC
LIMIT 5;
```

### 3.5 Recent Meter Readings for Trust Epoch Delta

- **Target Table:** `meter_readings`
- **Recommended Index:** `idx_meter_readings_asset_date_desc`
- **Execution Scan Type:** `Index Scan`
- **Total Cost:** `6.85`
- **Execution Time:** `0.31 ms`
- **Status:** Optimal: Utilizing Index Scan via [idx_meter_readings_asset_date_desc]

```sql
SELECT id, value, reading_type, reading_date
FROM meter_readings
WHERE asset_id = 'asset-001'
ORDER BY reading_date DESC
LIMIT 10;
```


---

## 4. Connection Pool & Concurrency Metrics

- **Configured Connection Pool:** `ManagedPgPool` (Max: 20, Min: 2, Idle Timeout: 30s)
- **PgBouncer Compatibility:** Transaction-local settings (`SET LOCAL`) cleanly scoped; zero connection leak risk.
- **Next Steps:** NestJS modular domain architecture migration (Section 11).
