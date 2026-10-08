-- ============================================================================
-- PostgreSQL Row-Level Security (RLS) & Runtime Role Hardening (Task RLS-01)
-- Target: PostgreSQL 16+ LTS
-- Database: fuelsystem_erp
-- Reference: Master Plan Section 7 (Security and Isolation) & ADR 0002
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Database Role Segregation (Least-Privilege Principle)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  -- fuelsystem_migrator: Schema owner for migrations and DDL execution
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fuelsystem_migrator') THEN
    CREATE ROLE fuelsystem_migrator WITH LOGIN PASSWORD 'migrator_secure_pass';
  END IF;

  -- fuelsystem_app: Application runtime role restricted strictly to DML operations
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fuelsystem_app') THEN
    CREATE ROLE fuelsystem_app WITH LOGIN PASSWORD 'app_runtime_secure_pass';
  END IF;
END $$;

-- Ensure fuelsystem_app cannot perform DDL (CREATE, DROP, ALTER)
REVOKE CREATE ON SCHEMA public FROM fuelsystem_app;
GRANT USAGE ON SCHEMA public TO fuelsystem_app;
GRANT ALL PRIVILEGES ON SCHEMA public TO fuelsystem_migrator;

-- Grant standard DML privileges to runtime role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fuelsystem_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO fuelsystem_app;

-- Default privileges for tables/sequences created in future migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fuelsystem_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fuelsystem_app;

-- ----------------------------------------------------------------------------
-- 2. Session Context Evaluation Helpers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rls_is_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_user_role', true), '') = 'ADMIN'
      OR COALESCE(current_setting('app.bypass_rls', true), '') = 'true';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION rls_current_role() RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_user_role', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION rls_current_project_id() RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_project_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION rls_current_tank_id() RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_tank_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION rls_current_user_id() RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_user_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 3. Enable RLS and FORCE ROW LEVEL SECURITY across all tenant tables
-- ----------------------------------------------------------------------------

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

ALTER TABLE bulk_tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_tanks FORCE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;

ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE vehicle_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_allocations FORCE ROW LEVEL SECURITY;

ALTER TABLE fuel_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_prices FORCE ROW LEVEL SECURITY;

ALTER TABLE fuel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE fuel_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_issues FORCE ROW LEVEL SECURITY;

ALTER TABLE fuel_issue_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_issue_corrections FORCE ROW LEVEL SECURITY;

ALTER TABLE tank_dips ENABLE ROW LEVEL SECURITY;
ALTER TABLE tank_dips FORCE ROW LEVEL SECURITY;

ALTER TABLE bulk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE daily_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_conditions FORCE ROW LEVEL SECURITY;

ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings FORCE ROW LEVEL SECURITY;

ALTER TABLE meter_outages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_outages FORCE ROW LEVEL SECURITY;

ALTER TABLE rental_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_rates FORCE ROW LEVEL SECURITY;

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills FORCE ROW LEVEL SECURITY;

ALTER TABLE bill_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_revisions FORCE ROW LEVEL SECURITY;

ALTER TABLE bill_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_line_items FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE billing_site_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_site_overrides FORCE ROW LEVEL SECURITY;

ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_records FORCE ROW LEVEL SECURITY;

ALTER TABLE service_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_intervals FORCE ROW LEVEL SECURITY;

ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items FORCE ROW LEVEL SECURITY;

ALTER TABLE service_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_attachments FORCE ROW LEVEL SECURITY;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_messages FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. Fuel Transaction Security Policies (fuel_issues, fuel_requests, corrections)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS fuel_issues_select_policy ON fuel_issues;
CREATE POLICY fuel_issues_select_policy ON fuel_issues
  FOR SELECT
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND (bulk_tank_id::text = rls_current_tank_id() OR project_id::text = rls_current_project_id()))
    OR (rls_current_role() IN ('USER', 'ALLOCATOR') AND project_id::text = rls_current_project_id())
    OR (rls_current_role() = 'WORKSHOP' AND (source_type = 'WORKSHOP' OR project_id::text = rls_current_project_id()))
  );

DROP POLICY IF EXISTS fuel_issues_insert_policy ON fuel_issues;
CREATE POLICY fuel_issues_insert_policy ON fuel_issues
  FOR INSERT
  WITH CHECK (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND (bulk_tank_id::text = rls_current_tank_id() OR rls_current_tank_id() = ''))
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
    OR (rls_current_role() = 'WORKSHOP' AND source_type = 'WORKSHOP')
  );

DROP POLICY IF EXISTS fuel_issues_update_policy ON fuel_issues;
CREATE POLICY fuel_issues_update_policy ON fuel_issues
  FOR UPDATE
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND bulk_tank_id::text = rls_current_tank_id())
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
  )
  WITH CHECK (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND bulk_tank_id::text = rls_current_tank_id())
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
  );

DROP POLICY IF EXISTS fuel_issues_delete_policy ON fuel_issues;
CREATE POLICY fuel_issues_delete_policy ON fuel_issues
  FOR DELETE
  USING (rls_is_admin()); -- Fuel issues must never be hard-deleted by runtime users (use VOID status)

-- Fuel Issue Corrections
DROP POLICY IF EXISTS fuel_corrections_policy ON fuel_issue_corrections;
CREATE POLICY fuel_corrections_policy ON fuel_issue_corrections
  FOR ALL
  USING (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  )
  WITH CHECK (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  );

-- ----------------------------------------------------------------------------
-- 5. Financial & Billing Policies (bills, line_items, credit_notes, payments)
-- ----------------------------------------------------------------------------

-- Enforces SEC-02 rule: WORKSHOP and SITE_PUMP roles are strictly denied billing access
DROP POLICY IF EXISTS bills_select_policy ON bills;
CREATE POLICY bills_select_policy ON bills
  FOR SELECT
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
    -- Explicitly false for WORKSHOP and SITE_PUMP
  );

DROP POLICY IF EXISTS bills_write_policy ON bills;
CREATE POLICY bills_write_policy ON bills
  FOR ALL
  USING (rls_is_admin())
  WITH CHECK (rls_is_admin());

DROP POLICY IF EXISTS bill_line_items_policy ON bill_line_items;
CREATE POLICY bill_line_items_policy ON bill_line_items
  FOR ALL
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'USER' AND EXISTS (
      SELECT 1 FROM bills b WHERE b.id = bill_line_items.bill_id AND b.project_id::text = rls_current_project_id()
    ))
  )
  WITH CHECK (rls_is_admin());

DROP POLICY IF EXISTS credit_notes_policy ON credit_notes;
CREATE POLICY credit_notes_policy ON credit_notes
  FOR ALL
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
  )
  WITH CHECK (rls_is_admin());

DROP POLICY IF EXISTS payments_policy ON payments;
CREATE POLICY payments_policy ON payments
  FOR ALL
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'USER' AND EXISTS (
      SELECT 1 FROM bills b WHERE b.id = payments.bill_id AND b.project_id::text = rls_current_project_id()
    ))
  )
  WITH CHECK (rls_is_admin());

-- ----------------------------------------------------------------------------
-- 6. Storage & Tanks (bulk_tanks, tank_dips, bulk_requests)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS bulk_tanks_select_policy ON bulk_tanks;
CREATE POLICY bulk_tanks_select_policy ON bulk_tanks
  FOR SELECT
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND (id::text = rls_current_tank_id() OR project_id::text = rls_current_project_id()))
    OR (project_id::text = rls_current_project_id())
  );

DROP POLICY IF EXISTS bulk_tanks_update_policy ON bulk_tanks;
CREATE POLICY bulk_tanks_update_policy ON bulk_tanks
  FOR UPDATE
  USING (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND id::text = rls_current_tank_id())
  )
  WITH CHECK (
    rls_is_admin()
    OR (rls_current_role() = 'SITE_PUMP' AND id::text = rls_current_tank_id())
  );

-- ----------------------------------------------------------------------------
-- 7. Assets, Assignments, and Metering
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS assets_policy ON assets;
CREATE POLICY assets_policy ON assets
  FOR ALL
  USING (true) -- Assets are globally cataloged master records across projects
  WITH CHECK (rls_is_admin() OR rls_current_role() IN ('USER', 'ALLOCATOR', 'WORKSHOP'));

DROP POLICY IF EXISTS asset_assignments_policy ON asset_assignments;
CREATE POLICY asset_assignments_policy ON asset_assignments
  FOR ALL
  USING (
    rls_is_admin()
    OR project_id::text = rls_current_project_id()
    OR rls_current_role() IN ('ALLOCATOR', 'WORKSHOP')
  )
  WITH CHECK (
    rls_is_admin()
    OR project_id::text = rls_current_project_id()
    OR rls_current_role() = 'ALLOCATOR'
  );

DROP POLICY IF EXISTS meter_readings_policy ON meter_readings;
CREATE POLICY meter_readings_policy ON meter_readings
  FOR ALL
  USING (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  )
  WITH CHECK (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  );

DROP POLICY IF EXISTS meter_outages_policy ON meter_outages;
CREATE POLICY meter_outages_policy ON meter_outages
  FOR ALL
  USING (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  )
  WITH CHECK (
    rls_is_admin()
    OR rls_current_role() IN ('USER', 'SITE_PUMP', 'ALLOCATOR', 'WORKSHOP')
  );

-- ----------------------------------------------------------------------------
-- 8. Workshop Maintenance (service_records, intervals, items, attachments)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS service_records_policy ON service_records;
CREATE POLICY service_records_policy ON service_records
  FOR ALL
  USING (
    rls_is_admin()
    OR rls_current_role() = 'WORKSHOP'
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
  )
  WITH CHECK (
    rls_is_admin()
    OR rls_current_role() = 'WORKSHOP'
    OR (rls_current_role() = 'USER' AND project_id::text = rls_current_project_id())
  );

-- ----------------------------------------------------------------------------
-- 9. Append-Only Immutability for Audit Trail (audit_logs)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_logs_select_policy ON audit_logs;
CREATE POLICY audit_logs_select_policy ON audit_logs
  FOR SELECT
  USING (
    rls_is_admin()
    OR rls_current_user_id() = user_id::text
  );

DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs;
CREATE POLICY audit_logs_insert_policy ON audit_logs
  FOR INSERT
  WITH CHECK (true); -- Any authenticated session can append audit records

DROP POLICY IF EXISTS audit_logs_update_policy ON audit_logs;
CREATE POLICY audit_logs_update_policy ON audit_logs
  FOR UPDATE
  USING (false)
  WITH CHECK (false); -- STRICTLY DENIED: Audit logs are append-only and immutable

DROP POLICY IF EXISTS audit_logs_delete_policy ON audit_logs;
CREATE POLICY audit_logs_delete_policy ON audit_logs
  FOR DELETE
  USING (false); -- STRICTLY DENIED: Audit logs must never be deleted

-- ----------------------------------------------------------------------------
-- 10. Outbox Messages (Asynchronous event broker queue)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS outbox_messages_policy ON outbox_messages;
CREATE POLICY outbox_messages_policy ON outbox_messages
  FOR ALL
  USING (rls_is_admin())
  WITH CHECK (true); -- Workers and application commands can produce outbox events
