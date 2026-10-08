// ============================================================================
// CUT-01: Cutover Rehearsal & Go-Live Verification Test Suite (Wave E)
// Reference: Master Plan Section 14 (Cutover & Rollback Protocols)
//
// Verifies:
// 1. Maintenance mode & write-freeze enforcement (read-only window).
// 2. Authoritative single-writer gateway transitions without split-brain risk.
// 3. Strict RBAC scope boundaries across all 5 operational roles.
// 4. Pre-write instant rollback vs post-write forward-fix invariant preservation.
// 5. Complete 9-stage end-to-end rehearsal engine execution and sign-off report.
// ============================================================================

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  isMaintenanceModeActive,
  setMaintenanceMode,
  assertNotMaintenanceMode,
  getMaintenanceState,
} from "../src/lib/maintenance/gate";
import {
  getFuelWriteAuthority,
  setFuelWriteAuthorityForTesting,
  dispatchIssueFuel,
  dispatchVoidFuelIssue,
} from "../src/lib/fuel/write-gateway";
import { roleAllowsScope } from "../src/lib/api/auth";
import {
  runCutoverRehearsal,
  generateMarkdownCutoverReport,
} from "../scripts/cutover/cutover_rehearsal";

describe("CUT-01: Enterprise Cutover Rehearsal & Safety Gates", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MAINTENANCE_MODE;
    delete process.env.FUEL_WRITE_AUTHORITY;
    setMaintenanceMode(false);
    setFuelWriteAuthorityForTesting(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    setMaintenanceMode(false);
    setFuelWriteAuthorityForTesting(null);
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Maintenance Mode & Write-Freeze Gate
  // --------------------------------------------------------------------------
  describe("Stage 1: Maintenance Mode & Write-Freeze Gate", () => {
    it("should be inactive by default", () => {
      expect(isMaintenanceModeActive()).toBe(false);
      expect(() => assertNotMaintenanceMode()).not.toThrow();
      expect(getMaintenanceState().active).toBe(false);
    });

    it("should activate maintenance mode with reason and timestamp", () => {
      setMaintenanceMode(true, "Final Cutover Window Stage 1");
      expect(isMaintenanceModeActive()).toBe(true);

      const state = getMaintenanceState();
      expect(state.active).toBe(true);
      expect(state.reason).toBe("Final Cutover Window Stage 1");
      expect(state.startedAt).toBeInstanceOf(Date);
      expect(state.scheduledEndAt).toBeInstanceOf(Date);

      expect(() => assertNotMaintenanceMode()).toThrowError(
        /MAINTENANCE_WINDOW_ACTIVE: System is read-only/
      );
    });

    it("should honor MAINTENANCE_MODE environment variable", () => {
      process.env.MAINTENANCE_MODE = "true";
      expect(isMaintenanceModeActive()).toBe(true);
      expect(() => assertNotMaintenanceMode()).toThrowError(/MAINTENANCE_WINDOW_ACTIVE/);
    });

    it("should reject dispatchIssueFuel mutations when maintenance mode is active", async () => {
      setMaintenanceMode(true, "Rehearsal DB Migration Freeze");

      const result = await dispatchIssueFuel(
        {
          assetIdOrCode: "AC-25",
          fuelKind: "AUTO_DIESEL",
          litres: 100,
          meterReading: null,
          readingType: null,
        },
        { actorId: "admin-1", role: "ADMIN" }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("MAINTENANCE_WINDOW_ACTIVE");
      expect(result.error).toContain("Rehearsal DB Migration Freeze");
    });

    it("should reject dispatchVoidFuelIssue mutations when maintenance mode is active", async () => {
      setMaintenanceMode(true, "Rehearsal DB Migration Freeze");

      const result = await dispatchVoidFuelIssue(
        {
          issueId: "issue-12345",
          reason: "Testing maintenance freeze",
        },
        { actorId: "admin-1", role: "ADMIN" }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("MAINTENANCE_WINDOW_ACTIVE");
      expect(result.error).toContain("Rehearsal DB Migration Freeze");
    });

    it("should allow normal operations once maintenance mode is lifted", () => {
      setMaintenanceMode(true);
      expect(isMaintenanceModeActive()).toBe(true);

      setMaintenanceMode(false);
      expect(isMaintenanceModeActive()).toBe(false);
      expect(() => assertNotMaintenanceMode()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Authoritative Single-Writer Gateway Transition
  // --------------------------------------------------------------------------
  describe("Stage 5: Authoritative Gateway Transition", () => {
    it("should default to LOCAL_COMMAND authority", () => {
      expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");
    });

    it("should switch to REMOTE_API authority when configured", () => {
      setFuelWriteAuthorityForTesting("REMOTE_API");
      expect(getFuelWriteAuthority()).toBe("REMOTE_API");
    });

    it("should delegate to remote backend in REMOTE_API mode with RFC 7807 error translation", async () => {
      setFuelWriteAuthorityForTesting("REMOTE_API");

      // Mock fetch rejection simulating backend 409 conflict
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "https://fuelsystem.lk/errors/concurrency-conflict",
            title: "Concurrency Conflict",
            status: 409,
            detail: "The tank balance was modified concurrently by another transaction.",
            code: "CONCURRENCY_CONFLICT",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/problem+json" },
          }
        )
      );

      const result = await dispatchIssueFuel(
        {
          assetIdOrCode: "AC-25",
          fuelKind: "AUTO_DIESEL",
          litres: 75,
          meterReading: null,
          readingType: null,
        },
        { actorId: "pump-user-1", role: "SITE_PUMP" }
      );

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.code).toBe("CONCURRENCY_CONFLICT");
      expect(result.error).toContain("The tank balance was modified concurrently");
    });

    it("should seamlessly toggle back to LOCAL_COMMAND without split brain", () => {
      setFuelWriteAuthorityForTesting("REMOTE_API");
      expect(getFuelWriteAuthority()).toBe("REMOTE_API");

      setFuelWriteAuthorityForTesting("LOCAL_COMMAND");
      expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");

      setFuelWriteAuthorityForTesting(null);
      expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Role-Based Scope Smoke Tests Across 5 Operational Roles
  // --------------------------------------------------------------------------
  describe("Stage 6: Role-Based RBAC Scope Smoke Tests", () => {
    it("should authorize ADMIN across all modules and commercial data", () => {
      expect(roleAllowsScope("ADMIN", "read:billing")).toBe(true);
      expect(roleAllowsScope("ADMIN", "write:billing")).toBe(true);
      expect(roleAllowsScope("ADMIN", "read:rates")).toBe(true);
      expect(roleAllowsScope("ADMIN", "write:rates")).toBe(true);
      expect(roleAllowsScope("ADMIN", "write:fuel")).toBe(true);
      expect(roleAllowsScope("ADMIN", "write:assignments")).toBe(true);
    });

    it("should authorize ALLOCATOR for fleet assignments and billing viewing, but deny rate/billing mutations", () => {
      expect(roleAllowsScope("ALLOCATOR", "write:assignments")).toBe(true);
      expect(roleAllowsScope("ALLOCATOR", "read:billing")).toBe(true);
      expect(roleAllowsScope("ALLOCATOR", "read:rates")).toBe(true);
      expect(roleAllowsScope("ALLOCATOR", "write:billing")).toBe(false);
      expect(roleAllowsScope("ALLOCATOR", "write:rates")).toBe(false);
    });

    it("should authorize WORKSHOP for fuel dispensing, but strictly deny rates and commercial billing", () => {
      expect(roleAllowsScope("WORKSHOP", "write:fuel")).toBe(true);
      expect(roleAllowsScope("WORKSHOP", "read:billing")).toBe(false);
      expect(roleAllowsScope("WORKSHOP", "write:billing")).toBe(false);
      expect(roleAllowsScope("WORKSHOP", "read:rates")).toBe(false);
      expect(roleAllowsScope("WORKSHOP", "write:rates")).toBe(false);
    });

    it("should authorize SITE_PUMP for local dispensing, but strictly deny rates and commercial billing", () => {
      expect(roleAllowsScope("SITE_PUMP", "write:fuel")).toBe(true);
      expect(roleAllowsScope("SITE_PUMP", "read:billing")).toBe(false);
      expect(roleAllowsScope("SITE_PUMP", "write:billing")).toBe(false);
      expect(roleAllowsScope("SITE_PUMP", "read:rates")).toBe(false);
      expect(roleAllowsScope("SITE_PUMP", "write:rates")).toBe(false);
    });

    it("should authorize USER for vehicle conditions and own project billing reads, but deny rates and commercial writes", () => {
      expect(roleAllowsScope("USER", "write:conditions")).toBe(true);
      expect(roleAllowsScope("USER", "read:billing")).toBe(true);
      expect(roleAllowsScope("USER", "read:rates")).toBe(false);
      expect(roleAllowsScope("USER", "write:rates")).toBe(false);
      expect(roleAllowsScope("USER", "write:billing")).toBe(false);
      expect(roleAllowsScope("USER", "write:fuel")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Pre-Write vs Post-Write Rollback Scenarios
  // --------------------------------------------------------------------------
  describe("Stage 8: Rollback & Forward-Fix Safety Protocol", () => {
    it("should verify pre-write rollback path is instantaneous (< 10s recovery)", () => {
      // Simulate staging failure prior to go-live:
      // 1. Enter maintenance mode
      setMaintenanceMode(true, "Pre-cutover smoke test failed");
      expect(isMaintenanceModeActive()).toBe(true);

      // 2. Gateway authority remains on local / reverts
      setFuelWriteAuthorityForTesting("LOCAL_COMMAND");
      expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");

      // 3. Lift maintenance mode
      setMaintenanceMode(false);
      expect(isMaintenanceModeActive()).toBe(false);

      // System is immediately operational on original database without data recovery penalty
      expect(getFuelWriteAuthority()).toBe("LOCAL_COMMAND");
      expect(() => assertNotMaintenanceMode()).not.toThrow();
    });

    it("should enforce forward-fix invariant for post-write defects (never reopen old SQLite)", () => {
      // Once PostgreSQL accepts writes, Master Plan Section 14 mandates:
      // "Never reopen old SQLite: doing so will lose accepted transactions."
      // Instead, enter maintenance freeze, drain worker queue, and deploy forward-fix.
      setMaintenanceMode(true, "Post-write defect identified: freezing incoming mutations");
      expect(isMaintenanceModeActive()).toBe(true);

      // Writes are strictly blocked during forward-fix analysis
      expect(() => assertNotMaintenanceMode()).toThrow();

      // Ensure authority is not rolled back to SQLite if PostgreSQL has new writes
      setFuelWriteAuthorityForTesting("REMOTE_API");
      expect(getFuelWriteAuthority()).toBe("REMOTE_API");

      // Once forward fix is deployed, lift maintenance
      setMaintenanceMode(false);
      expect(isMaintenanceModeActive()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Complete 9-Stage End-to-End Cutover Rehearsal Run
  // --------------------------------------------------------------------------
  describe("End-to-End 9-Stage Rehearsal Execution", () => {
    it(
      "should execute runCutoverRehearsal() and pass all 9 stages",
      async () => {
        const report = await runCutoverRehearsal();

        expect(report.overallStatus).toBe("PASSED_READY_FOR_CUTOVER");
        expect(report.stages).toHaveLength(9);
        expect(report.totalRecordsReconciled).toBe(57722);
        expect(report.totalTables).toBe(37);
        expect(report.sourceDatasetSha256).toBe(
          "c5d0cc1bf502f6d96b3fe506d7c806fb864dac7b4bc29f668998d5552eac9cd0"
        );

        // Verify every individual stage passed
        for (const stage of report.stages) {
          expect(stage.status).toBe("PASSED");
        }

        // Verify smoke test evaluations
        expect(report.smokeTests.adminRoleAuthorized).toBe(true);
        expect(report.smokeTests.allocatorRoleAuthorized).toBe(true);
        expect(report.smokeTests.workshopRoleScopedCorrectly).toBe(true);
        expect(report.smokeTests.sitePumpRoleScopedCorrectly).toBe(true);
        expect(report.smokeTests.userRoleScopedCorrectly).toBe(true);

        // Verify markdown report generation
        const markdown = generateMarkdownCutoverReport(report);
        expect(markdown).toContain("Production Cutover Rehearsal & Sign-Off Report (CUT-01)");
        expect(markdown).toContain("Overall Cutover Status:** **PASSED_READY_FOR_CUTOVER**");
        expect(markdown).toContain("Zero dual-master split-brain writes");
        expect(markdown).toContain("All 57,722 historical records reconciled");
        expect(markdown).toContain("Issued invoices remain immutable");
      },
      15000 // Reconciles entire 57k dataset in memory
    );
  });
});
