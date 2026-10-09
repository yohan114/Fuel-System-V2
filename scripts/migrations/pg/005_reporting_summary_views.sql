-- ============================================================================
-- Phase 17: Read-Optimized Materialized Views & Summary Tables
-- Reference: Fuel-System-V3 Plan Section 22 (Phase 17 — Reporting and Analytics)
--
-- Creates database-level materialized aggregates for:
-- 1. daily_fuel_summary
-- 2. monthly_fuel_summary
-- 3. asset_utilization_summary
-- 4. billing_summary
--
-- Features:
-- - Unique composite indexes supporting REFRESH MATERIALIZED VIEW CONCURRENTLY
-- - Fast index scans for dashboard analytics (<1ms lookup)
-- - Zero locking on live transactional tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Daily Fuel Summary
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_fuel_summary AS
SELECT
    DATE(fi."issueDate") AS day_date,
    COALESCE(bt."projectId", a."projectId") AS project_id,
    fi."fuelKind" AS fuel_kind,
    COUNT(fi.id)::int AS issue_count,
    COUNT(DISTINCT fi."assetId")::int AS active_asset_count,
    ROUND(SUM(fi.litres)::numeric, 2) AS total_litres,
    COALESCE(SUM(fi."totalCostCents"), 0)::bigint AS total_cost_cents,
    NOW() AS refreshed_at
FROM "FuelIssue" fi
JOIN "Asset" a ON fi."assetId" = a.id
LEFT JOIN "BulkTank" bt ON fi."bulkTankId" = bt.id
WHERE fi.voided = false
GROUP BY DATE(fi."issueDate"), COALESCE(bt."projectId", a."projectId"), fi."fuelKind";

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_fuel_summary
ON daily_fuel_summary (day_date, project_id, fuel_kind);

CREATE INDEX IF NOT EXISTS idx_daily_fuel_summary_lookup
ON daily_fuel_summary (day_date DESC, project_id);

-- ----------------------------------------------------------------------------
-- 2. Monthly Fuel Summary
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_fuel_summary AS
SELECT
    TO_CHAR(fi."issueDate", 'YYYY-MM') AS period_key,
    COALESCE(bt."projectId", a."projectId") AS project_id,
    fi."fuelKind" AS fuel_kind,
    COUNT(fi.id)::int AS issue_count,
    COUNT(DISTINCT fi."assetId")::int AS active_asset_count,
    ROUND(SUM(fi.litres)::numeric, 2) AS total_litres,
    COALESCE(SUM(fi."totalCostCents"), 0)::bigint AS total_cost_cents,
    NOW() AS refreshed_at
FROM "FuelIssue" fi
JOIN "Asset" a ON fi."assetId" = a.id
LEFT JOIN "BulkTank" bt ON fi."bulkTankId" = bt.id
WHERE fi.voided = false
GROUP BY TO_CHAR(fi."issueDate", 'YYYY-MM'), COALESCE(bt."projectId", a."projectId"), fi."fuelKind";

CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_fuel_summary
ON monthly_fuel_summary (period_key, project_id, fuel_kind);

CREATE INDEX IF NOT EXISTS idx_monthly_fuel_summary_lookup
ON monthly_fuel_summary (period_key, project_id);

-- ----------------------------------------------------------------------------
-- 3. Asset Utilization Summary
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS asset_utilization_summary AS
SELECT
    TO_CHAR(fi."issueDate", 'YYYY-MM') AS period_key,
    fi."assetId" AS asset_id,
    a.code AS asset_code,
    a."meterType" AS meter_type,
    a."categoryId" AS category_id,
    COUNT(fi.id)::int AS issue_count,
    ROUND(SUM(fi.litres)::numeric, 2) AS total_litres,
    COALESCE(SUM(fi."totalCostCents"), 0)::bigint AS total_cost_cents,
    MIN(fi."meterReading") AS min_meter_reading,
    MAX(fi."meterReading") AS max_meter_reading,
    NOW() AS refreshed_at
FROM "FuelIssue" fi
JOIN "Asset" a ON fi."assetId" = a.id
WHERE fi.voided = false
GROUP BY TO_CHAR(fi."issueDate", 'YYYY-MM'), fi."assetId", a.code, a."meterType", a."categoryId";

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_utilization_summary
ON asset_utilization_summary (period_key, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_utilization_lookup
ON asset_utilization_summary (period_key, category_id);

-- ----------------------------------------------------------------------------
-- 4. Billing Summary
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS billing_summary AS
SELECT
    b."periodKey" AS period_key,
    b."projectId" AS project_id,
    b.status AS status,
    COUNT(b.id)::int AS invoice_count,
    COALESCE(SUM(b."baseHireCents"), 0)::bigint AS total_base_cents,
    COALESCE(SUM(b."fuelChargeCents"), 0)::bigint AS total_fuel_charge_cents,
    COALESCE(SUM(b."taxCents"), 0)::bigint AS total_tax_cents,
    COALESCE(SUM(b."discountCents"), 0)::bigint AS total_discount_cents,
    COALESCE(SUM(b."grandTotalCents"), 0)::bigint AS total_grand_cents,
    COALESCE(SUM(b."totalPaidCents"), 0)::bigint AS total_paid_cents,
    COALESCE(SUM(b."balanceDueCents"), 0)::bigint AS total_balance_due_cents,
    NOW() AS refreshed_at
FROM "Bill" b
GROUP BY b."periodKey", b."projectId", b.status;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_summary
ON billing_summary (period_key, project_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_summary_lookup
ON billing_summary (period_key, project_id);
