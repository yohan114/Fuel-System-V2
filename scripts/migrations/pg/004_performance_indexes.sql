-- ============================================================================
-- PostgreSQL Performance & Composite Indexes Migration (Step 08)
-- Reference: Fuel-System-V3 Plan Section 10 (Phase 5 — Database Redesign & Index Strategy)
-- Target: PostgreSQL 16+ LTS
-- ============================================================================

-- 1. Fuel Issues Composite & Partial Indexes
-- Optimizes: /fuel/issues list, vehicle fuel history, and monthly dashboard rollups

-- Asset + Date descending index for asset fuel logs and paginated listings
CREATE INDEX IF NOT EXISTS idx_fuel_issues_asset_date_desc
  ON fuel_issues (asset_id, issue_date DESC);

-- Tank + Date descending index for pump/tank books
CREATE INDEX IF NOT EXISTS idx_fuel_issues_tank_date_desc
  ON fuel_issues (bulk_tank_id, issue_date DESC);

-- Partial index for active (non-voided) fuel issues to eliminate void filter overhead
CREATE INDEX IF NOT EXISTS idx_fuel_issues_active_date_desc
  ON fuel_issues (issue_date DESC)
  WHERE voided = FALSE;

-- Covering index for monthly consumption and financial aggregation queries
CREATE INDEX IF NOT EXISTS idx_fuel_issues_month_agg
  ON fuel_issues (issue_date, voided, litres, total_cost)
  INCLUDE (fuel_kind, asset_id);

-- 2. Fleet & Asset Composite Indexes
-- Optimizes: /fleet directory, search by registration plate, and site-scoped listings

-- Status + Project + Code composite index for site-filtered fleet listings
CREATE INDEX IF NOT EXISTS idx_assets_status_project_code
  ON assets (status, project_id, code);

-- Registration number lookup index for fleet search
CREATE INDEX IF NOT EXISTS idx_assets_reg_no_lookup
  ON assets (reg_no)
  WHERE reg_no IS NOT NULL;

-- 3. Billing & Invoices Composite Indexes
-- Optimizes: /billing monthly statements, site splits, and highest-value ranking

-- Period key + Status + Project ID composite index for monthly billing views
CREATE INDEX IF NOT EXISTS idx_bills_period_status_proj
  ON bills (period_key, status, project_id);

-- Grand total descending index for invoice value sorting
CREATE INDEX IF NOT EXISTS idx_bills_grand_total_desc
  ON bills (grand_total_cents DESC);

-- 4. Meter Readings & Outages Indexes
-- Optimizes: Odometer/Hour meter progression and meter trust calculations

-- Asset + Reading date descending index for continuous meter difference queries
CREATE INDEX IF NOT EXISTS idx_meter_readings_asset_date_desc
  ON meter_readings (asset_id, reading_date DESC);

-- 5. Operational Workflow Partial Indexes
-- Optimizes: Dashboard quick actions and pending approvals

-- Partial index for pending fuel requests requiring supervisor review
CREATE INDEX IF NOT EXISTS idx_fuel_requests_pending_date
  ON fuel_requests (created_at DESC)
  WHERE status = 'PENDING';

-- Daily condition date descending index for equipment availability widget
CREATE INDEX IF NOT EXISTS idx_daily_conditions_asset_date_desc
  ON daily_conditions (asset_id, log_date DESC);
