-- ============================================================================
-- PostgreSQL Initial Schema Migration (Task PG-01 / Wave C Rehearsal)
-- Target: PostgreSQL 16+ LTS
-- Database: fuelsystem_erp
-- ============================================================================

-- 1. Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================================
-- 2. Core & Master Tables
-- ============================================================================

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Projects / Sites
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  contact_name VARCHAR(255) NULL,
  contact_email VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  default_meter_type VARCHAR(20) NOT NULL CHECK (default_meter_type IN ('KM', 'HOURS')),
  fleet_group VARCHAR(50) NOT NULL CHECK (fleet_group IN ('ROAD_VEHICLE', 'MACHINERY_GENSET'))
);

-- Storage / Bulk Tanks
CREATE TABLE IF NOT EXISTS bulk_tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  fuel_kind VARCHAR(50) NOT NULL,
  capacity NUMERIC(12, 2) NOT NULL CHECK (capacity > 0),
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.0 CHECK (balance >= 0), -- Physical balance cannot drop below zero
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'USER', 'ALLOCATOR', 'WORKSHOP', 'SITE_PUMP')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  bulk_tank_id UUID NULL REFERENCES bulk_tanks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(50) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '*',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

-- ============================================================================
-- 3. Fleet & Vehicle Tracking
-- ============================================================================

-- Assets
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  brand VARCHAR(100) NULL,
  type_label VARCHAR(100) NULL,
  model VARCHAR(100) NULL,
  reg_no VARCHAR(50) NULL,
  capacity VARCHAR(50) NULL,
  yom INT NULL,
  chassis_no VARCHAR(100) NULL,
  engine_no VARCHAR(100) NULL,
  serial_no VARCHAR(100) NULL,
  site VARCHAR(100) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DISPOSED')),
  meter_type VARCHAR(20) NOT NULL CHECK (meter_type IN ('KM', 'HOURS')),
  daily_cap_litres INT NULL CHECK (daily_cap_litres IS NULL OR daily_cap_litres >= 0),
  ownership VARCHAR(20) NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED', 'HIRED')),
  hire_supplier VARCHAR(255) NULL,
  hire_rate_cents BIGINT NULL CHECK (hire_rate_cents IS NULL OR hire_rate_cents >= 0),
  hire_rate_basis VARCHAR(20) NULL,
  hire_start TIMESTAMPTZ NULL,
  hire_end TIMESTAMPTZ NULL,
  hire_note TEXT NULL,
  min_bill_hours INT NULL,
  bill_fuel_only BOOLEAN NOT NULL DEFAULT FALSE,
  billed_direct BOOLEAN NOT NULL DEFAULT FALSE,
  category_id UUID NOT NULL REFERENCES categories(id),
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Asset Assignments (Postings with Temporal Exclusion Constraint)
CREATE TABLE IF NOT EXISTS asset_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NULL,
  note TEXT NULL,
  origin VARCHAR(20) NOT NULL DEFAULT 'FUEL' CHECK (origin IN ('FUEL', 'MANUAL')),
  driver_name VARCHAR(255) NULL,
  billing_type VARCHAR(20) NULL CHECK (billing_type IS NULL OR billing_type IN ('DRY', 'WET')),
  created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_assignments_asset_date ON asset_assignments(asset_id, start_date);
CREATE INDEX IF NOT EXISTS idx_assignments_proj_date ON asset_assignments(project_id, start_date);
CREATE INDEX IF NOT EXISTS idx_assignments_open ON asset_assignments(asset_id) WHERE end_date IS NULL;

-- Temporal Exclusion Constraint: No overlapping assignments for the same asset
ALTER TABLE asset_assignments
  ADD CONSTRAINT no_overlapping_asset_assignments
  EXCLUDE USING gist (
    asset_id WITH =,
    daterange(start_date::date, COALESCE(end_date::date, 'infinity'::date), '[]') WITH &&
  );

-- Vehicle Allocations (Monthly Audit Register)
CREATE TABLE IF NOT EXISTS vehicle_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key VARCHAR(255) NOT NULL UNIQUE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  site_name VARCHAR(255) NOT NULL,
  month VARCHAR(20) NOT NULL,
  asset_id UUID NULL REFERENCES assets(id) ON DELETE SET NULL,
  vehicle_no VARCHAR(100) NOT NULL,
  machine_type VARCHAR(100) NULL,
  owner_code VARCHAR(100) NULL,
  basis VARCHAR(100) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_file VARCHAR(255) NULL,
  source_sheet VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_allocations_proj_month ON vehicle_allocations(project_id, month);
CREATE INDEX IF NOT EXISTS idx_allocations_asset_month ON vehicle_allocations(asset_id, month);

-- Meter Readings
CREATE TABLE IF NOT EXISTS meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  value NUMERIC(12, 2) NOT NULL CHECK (value >= 0),
  reading_type VARCHAR(20) NOT NULL CHECK (reading_type IN ('KM', 'HOURS', 'HR')),
  reading_date TIMESTAMPTZ NOT NULL,
  source VARCHAR(50) NOT NULL,
  recorded_by_id UUID NOT NULL REFERENCES users(id),
  linked_issue_id UUID NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_meter_readings_asset_date ON meter_readings(asset_id, reading_date);

-- Meter Outages
CREATE TABLE IF NOT EXISTS meter_outages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  start_date TIMESTAMPTZ NOT NULL,
  opened_by_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NULL,
  end_date TIMESTAMPTZ NULL,
  end_physical_meter NUMERIC(12, 2) NULL CHECK (end_physical_meter IS NULL OR end_physical_meter >= 0),
  instrument_continuity VARCHAR(50) NULL CHECK (instrument_continuity IS NULL OR instrument_continuity IN ('repaired', 'replaced')),
  closed_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  close_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_meter_outages_asset ON meter_outages(asset_id, start_date);
CREATE INDEX IF NOT EXISTS idx_meter_outages_open ON meter_outages(asset_id) WHERE end_date IS NULL;

-- Daily Conditions
CREATE TABLE IF NOT EXISTS daily_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('WORKING', 'BREAKDOWN')),
  log_date TIMESTAMPTZ NOT NULL,
  note TEXT NULL,
  recorded_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_asset_log_date UNIQUE (asset_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_conditions_date ON daily_conditions(log_date);

-- ============================================================================
-- 4. Fuel Inventory & Operations
-- ============================================================================

-- Fuel Prices
CREATE TABLE IF NOT EXISTS fuel_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_kind VARCHAR(50) NOT NULL,
  price_per_litre BIGINT NOT NULL CHECK (price_per_litre > 0), -- cents
  effective_from TIMESTAMPTZ NOT NULL,
  source VARCHAR(50) NOT NULL CHECK (source IN ('CEYPETCO', 'MANUAL')),
  note TEXT NULL,
  entered_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_fuel_price_kind_date UNIQUE (fuel_kind, effective_from)
);

-- Fuel Requests
CREATE TABLE IF NOT EXISTS fuel_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  fuel_kind VARCHAR(50) NOT NULL,
  requested_litres NUMERIC(10, 2) NOT NULL CHECK (requested_litres > 0),
  meter_reading NUMERIC(12, 2) NULL CHECK (meter_reading IS NULL OR meter_reading >= 0),
  reading_type VARCHAR(20) NULL,
  reason TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by_id UUID NOT NULL REFERENCES users(id),
  reviewed_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  photo_data BYTEA NULL,
  photo_name VARCHAR(255) NULL,
  photo_mime VARCHAR(100) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Bulk Fuel Requests / Transfers
CREATE TABLE IF NOT EXISTS bulk_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_tank_id UUID NOT NULL REFERENCES bulk_tanks(id),
  fuel_kind VARCHAR(50) NOT NULL,
  requested_litres NUMERIC(12, 2) NOT NULL CHECK (requested_litres > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  source_type VARCHAR(20) NOT NULL DEFAULT 'OUTSIDE' CHECK (source_type IN ('OUTSIDE', 'SITE', 'TRANSFER', 'BOWSER')),
  source_tank_id UUID NULL REFERENCES bulk_tanks(id) ON DELETE SET NULL,
  requested_by_id UUID NOT NULL REFERENCES users(id),
  reviewed_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Tank Dips
CREATE TABLE IF NOT EXISTS tank_dips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_tank_id UUID NOT NULL REFERENCES bulk_tanks(id) ON DELETE CASCADE,
  dip_litres NUMERIC(12, 2) NOT NULL CHECK (dip_litres >= 0),
  computed_balance NUMERIC(12, 2) NOT NULL,
  variance NUMERIC(12, 2) NOT NULL,
  dip_date TIMESTAMPTZ NOT NULL,
  note TEXT NULL,
  recorded_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_tank_dips_tank_date ON tank_dips(bulk_tank_id, dip_date);

-- Fuel Issues
CREATE TABLE IF NOT EXISTS fuel_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  fuel_kind VARCHAR(50) NOT NULL,
  litres NUMERIC(10, 2) NOT NULL CHECK (litres > 0),
  meter_reading NUMERIC(12, 2) NULL CHECK (meter_reading IS NULL OR meter_reading >= 0),
  reading_type VARCHAR(20) NULL,
  price_per_litre BIGINT NOT NULL CHECK (price_per_litre >= 0), -- cents
  total_cost BIGINT NOT NULL CHECK (total_cost >= 0), -- cents
  source VARCHAR(50) NOT NULL,
  issue_date TIMESTAMPTZ NOT NULL,
  issued_by_id UUID NOT NULL REFERENCES users(id),
  fuel_price_id UUID NULL REFERENCES fuel_prices(id) ON DELETE SET NULL,
  linked_request_id UUID NULL UNIQUE REFERENCES fuel_requests(id) ON DELETE SET NULL,
  meter_reading_record_id UUID NULL UNIQUE,
  bulk_tank_id UUID NULL REFERENCES bulk_tanks(id) ON DELETE RESTRICT,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  voided_at TIMESTAMPTZ NULL,
  photo_data BYTEA NULL,
  photo_name VARCHAR(255) NULL,
  photo_mime VARCHAR(100) NULL,
  issue_person VARCHAR(255) NULL,
  import_key VARCHAR(255) NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Foreign key linkage back to meter_readings
ALTER TABLE meter_readings
  ADD CONSTRAINT fk_meter_reading_fuel_issue
  FOREIGN KEY (linked_issue_id) REFERENCES fuel_issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_issues_asset_date ON fuel_issues(asset_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_fuel_issues_unvoided ON fuel_issues(asset_id, issue_date) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS idx_fuel_issues_tank ON fuel_issues(bulk_tank_id);

-- Fuel Issue Corrections
CREATE TABLE IF NOT EXISTS fuel_issue_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_issue_id UUID NOT NULL REFERENCES fuel_issues(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('EDIT', 'VOID')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reason TEXT NOT NULL,
  new_litres NUMERIC(10, 2) NULL CHECK (new_litres IS NULL OR new_litres > 0),
  new_meter_reading NUMERIC(12, 2) NULL,
  new_reading_type VARCHAR(20) NULL,
  new_fuel_kind VARCHAR(50) NULL,
  new_issue_date TIMESTAMPTZ NULL,
  orig_litres NUMERIC(10, 2) NOT NULL,
  orig_meter_reading NUMERIC(12, 2) NULL,
  orig_fuel_kind VARCHAR(50) NOT NULL,
  orig_issue_date TIMESTAMPTZ NOT NULL,
  orig_source VARCHAR(50) NOT NULL,
  asset_id UUID NOT NULL,
  asset_code VARCHAR(50) NOT NULL,
  project_id UUID NULL,
  project_name VARCHAR(255) NULL,
  project_code VARCHAR(50) NULL,
  doc_data BYTEA NOT NULL,
  doc_name VARCHAR(255) NOT NULL,
  doc_mime VARCHAR(100) NOT NULL,
  requested_by_id UUID NOT NULL REFERENCES users(id),
  reviewed_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Billing Site Overrides
CREATE TABLE IF NOT EXISTS billing_site_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  period_key VARCHAR(20) NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('ADD', 'REMOVE')),
  reason TEXT NULL,
  set_fuel_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_site_override UNIQUE (project_id, period_key, asset_id)
);

-- ============================================================================
-- 5. Hire & Billing
-- ============================================================================

-- Rental Rates
CREATE TABLE IF NOT EXISTS rental_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
  source_label VARCHAR(100) NULL,
  category VARCHAR(50) NULL,
  equip_type VARCHAR(20) NOT NULL DEFAULT 'FLEET',
  fuel_qty_default NUMERIC(10, 2) NULL,
  op_rate BIGINT NULL,
  hr_fw_cents BIGINT NULL,
  hr_w_cents BIGINT NULL,
  hr_d_cents BIGINT NULL,
  dy_fw_cents BIGINT NULL,
  dy_w_cents BIGINT NULL,
  dy_d_cents BIGINT NULL,
  km_fw_cents BIGINT NULL,
  km_w_cents BIGINT NULL,
  km_d_cents BIGINT NULL,
  port_dw_cents BIGINT NULL,
  port_dd_cents BIGINT NULL,
  default_basis VARCHAR(20) NULL,
  fuel_cons_econ NUMERIC(8, 3) NULL,
  fuel_cons_typ NUMERIC(8, 3) NULL,
  fuel_cons_heavy NUMERIC(8, 3) NULL,
  fuel_cons_basis VARCHAR(20) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Bills / Invoices
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL CHECK (year >= 2020),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  period_key VARCHAR(20) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  asset_code VARCHAR(50) NOT NULL,
  asset_reg_no VARCHAR(50) NULL,
  asset_label VARCHAR(100) NULL,
  driver_name VARCHAR(255) NULL,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  project_name VARCHAR(255) NULL,
  project_code VARCHAR(50) NULL,
  billing_mode VARCHAR(20) NOT NULL,
  rate_basis VARCHAR(20) NOT NULL,
  rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
  opening_meter NUMERIC(12, 2) NULL,
  closing_meter NUMERIC(12, 2) NULL,
  actual_units NUMERIC(12, 2) NOT NULL,
  minimum_units NUMERIC(12, 2) NOT NULL,
  billable_units NUMERIC(12, 2) NOT NULL,
  rental_amount_cents BIGINT NOT NULL CHECK (rental_amount_cents >= 0),
  fuel_litres NUMERIC(12, 2) NOT NULL DEFAULT 0.0 CHECK (fuel_litres >= 0),
  fuel_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (fuel_cost_cents >= 0),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  sscl_rate NUMERIC(6, 4) NOT NULL,
  sscl_cents BIGINT NOT NULL CHECK (sscl_cents >= 0),
  vat_rate NUMERIC(6, 4) NOT NULL,
  vat_cents BIGINT NOT NULL CHECK (vat_cents >= 0),
  grand_total_cents BIGINT NOT NULL CHECK (grand_total_cents >= 0),
  invoice_number VARCHAR(50) NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED')),
  issued_date TIMESTAMPTZ NULL,
  due_date TIMESTAMPTZ NULL,
  paid_date TIMESTAMPTZ NULL,
  paid_amount_cents BIGINT NULL CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0),
  payment_ref VARCHAR(100) NULL,
  payment_note TEXT NULL,
  notes TEXT NULL,
  derived_from_fuel BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_meter_days INT NOT NULL DEFAULT 0,
  fuel_cons_mid_rate NUMERIC(8, 3) NULL,
  actual_meter_units NUMERIC(12, 2) NULL,
  derived_standard_units NUMERIC(12, 2) NULL,
  derived_econ_units NUMERIC(12, 2) NULL,
  fuel_cons_econ_snapshot NUMERIC(8, 3) NULL,
  fuel_cons_typ_snapshot NUMERIC(8, 3) NULL,
  fuel_cons_heavy_snapshot NUMERIC(8, 3) NULL,
  breakdown_days INT NOT NULL DEFAULT 0,
  breakdown_deduct_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  generated_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  emailed_at TIMESTAMPTZ NULL,
  emailed_to VARCHAR(255) NULL,
  CONSTRAINT uq_bill_asset_period UNIQUE (asset_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_bills_period_status ON bills(period_key, status);
CREATE INDEX IF NOT EXISTS idx_bills_project_period ON bills(project_id, period_key);

-- Bill Line Items
CREATE TABLE IF NOT EXISTS bill_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('RENTAL', 'FUEL', 'ADJUSTMENT')),
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  unit_rate_cents BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  project_name VARCHAR(255) NULL
);
CREATE INDEX IF NOT EXISTS idx_bill_line_items_bill ON bill_line_items(bill_id);

-- Bill Revisions
CREATE TABLE IF NOT EXISTS bill_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  revision INT NOT NULL,
  snapshot_json TEXT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  grand_total_cents BIGINT NOT NULL,
  reason TEXT NULL,
  created_by_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_bill_revision UNIQUE (bill_id, revision)
);

-- Invoice Counter
CREATE TABLE IF NOT EXISTS invoice_counters (
  id SERIAL PRIMARY KEY,
  year INT NOT NULL UNIQUE,
  last_seq INT NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_date TIMESTAMPTZ NOT NULL,
  method VARCHAR(50) NULL,
  reference VARCHAR(100) NULL,
  note TEXT NULL,
  created_by_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(bill_id);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  budget_litres NUMERIC(12, 2) NULL CHECK (budget_litres IS NULL OR budget_litres >= 0),
  budget_amount_cents BIGINT NULL CHECK (budget_amount_cents IS NULL OR budget_amount_cents >= 0),
  note TEXT NULL,
  created_by_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_budget_project_period UNIQUE (project_id, year, month)
);

-- Credit Notes
CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  number VARCHAR(50) NULL UNIQUE,
  reason TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED')),
  created_by_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  issued_date TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_bill ON credit_notes(bill_id);

-- ============================================================================
-- 6. Maintenance, Consumables & Services
-- ============================================================================

-- PM Tasks
CREATE TABLE IF NOT EXISTS pm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  task_code VARCHAR(50) NULL,
  interval_hours NUMERIC(10, 2) NOT NULL,
  interval_label VARCHAR(100) NOT NULL,
  system VARCHAR(100) NULL,
  component VARCHAR(100) NULL,
  description TEXT NOT NULL,
  parts TEXT NULL,
  skill VARCHAR(100) NULL,
  labor_hours NUMERIC(6, 2) NULL,
  notes TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_cat_interval ON pm_tasks(category_id, interval_hours, sort_order);

-- Service Intervals
CREATE TABLE IF NOT EXISTS service_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  asset_id UUID NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
  basis VARCHAR(20) NOT NULL CHECK (basis IN ('HOURS', 'KM')),
  interval_value NUMERIC(10, 2) NOT NULL,
  interval_months INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Service Records
CREATE TABLE IF NOT EXISTS service_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  service_date TIMESTAMPTZ NOT NULL,
  meter_at_service NUMERIC(12, 2) NULL,
  meter_type VARCHAR(20) NOT NULL CHECK (meter_type IN ('HOURS', 'KM')),
  service_type VARCHAR(100) NULL,
  cost_cents BIGINT NULL CHECK (cost_cents IS NULL OR cost_cents >= 0),
  note TEXT NULL,
  job_no VARCHAR(50) NULL,
  parts_cents BIGINT NULL,
  labour_cents BIGINT NULL,
  sundry_cents BIGINT NULL,
  manpower_cents BIGINT NULL,
  source_ref VARCHAR(100) NULL UNIQUE,
  location VARCHAR(100) NULL,
  next_service_meter NUMERIC(12, 2) NULL,
  condition VARCHAR(10) NULL,
  recorded_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_service_records_asset ON service_records(asset_id, service_date);

-- Service Items
CREATE TABLE IF NOT EXISTS service_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  kind VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  part_no VARCHAR(100) NULL,
  action VARCHAR(100) NULL,
  qty NUMERIC(10, 2) NOT NULL DEFAULT 1.0,
  unit_price_cents BIGINT NULL,
  amount_cents BIGINT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_items_record ON service_items(service_record_id);

-- Lubricants Catalogue
CREATE TABLE IF NOT EXISTS lubricants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  oil_type VARCHAR(100) NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'L',
  price_per_unit_cents BIGINT NULL,
  note TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Service Attachments
CREATE TABLE IF NOT EXISTS service_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Filters Master
CREATE TABLE IF NOT EXISTS filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NULL,
  oem_part_no VARCHAR(100) NULL,
  hifi_part_no VARCHAR(100) NULL,
  description TEXT NULL,
  price_cents BIGINT NULL,
  price_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Filter Cross-References
CREATE TABLE IF NOT EXISTS filter_cross_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id UUID NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
  brand VARCHAR(100) NULL,
  part_number VARCHAR(100) NOT NULL,
  normalized_pn VARCHAR(100) NOT NULL,
  ref_type VARCHAR(50) NULL
);
CREATE INDEX IF NOT EXISTS idx_filter_cross_refs_norm ON filter_cross_refs(normalized_pn);

-- Asset Filters
CREATE TABLE IF NOT EXISTS asset_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id UUID NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
  asset_id UUID NULL REFERENCES assets(id) ON DELETE CASCADE,
  vehicle_ref VARCHAR(100) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_filters_asset ON asset_filters(asset_id);

-- ============================================================================
-- 7. Audit & Event Infrastructure
-- ============================================================================

-- Immutable Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(50) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NULL,
  summary TEXT NOT NULL,
  meta_json JSONB NULL,
  actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);

-- Transactional Outbox Queue (Master Plan Section 3 & 8)
CREATE TABLE IF NOT EXISTS outbox_messages (
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
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_messages(created_at) WHERE processed_at IS NULL;

-- ============================================================================
-- 8. Row-Level Security (RLS) Activation (Master Plan Section 7)
-- ============================================================================

ALTER TABLE fuel_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;

-- Note: RLS policies will bind to runtime connection role 'fuelsystem_app'
-- and inspect current_setting('app.current_project_id', true).
