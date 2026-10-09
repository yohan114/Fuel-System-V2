// ============================================================================
// Phase 16 — Durable Workflows & Saga Orchestrator Test Suite
// Reference: Fuel-System-V3 Plan Section 21 (Phase 16 — Durable Workflows with Temporal)
//
// Tests:
// 1. Saga Orchestrator deterministic execution, state machines, and checkpointing
// 2. LIFO compensatory rollbacks on fatal step failures
// 3. Transient step retries and backoff
// 4. Crash-recovery resumption from persisted checkpoints
// 5. Month-end billing multi-step workflow with lock release and draft rollback
// 6. Fuel replenishment workflow with capacity guards and compensating ledger reversals
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SagaOrchestrator } from "@/lib/workflow/saga-orchestrator";
import {
  InMemoryWorkflowStore,
  type WorkflowStep,
} from "@/lib/workflow/types";
import {
  createMonthEndBillingWorkflow,
  type MonthEndBillingContext,
} from "@/lib/workflow/billing-workflow";
import {
  createFuelReplenishmentWorkflow,
  type ReplenishmentContext,
} from "@/lib/workflow/replenishment-workflow";
import { setRedisClient, InMemoryCacheClient } from "@/lib/cache/redis";

describe("Phase 16: Durable Workflows & Saga Orchestration Subsystem", () => {
  let store: InMemoryWorkflowStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setRedisClient(new InMemoryCacheClient());
    store = new InMemoryWorkflowStore();
  });

  // --------------------------------------------------------------------------
  // 1. Core Saga Orchestration & Deterministic Checkpointing
  // --------------------------------------------------------------------------
  describe("1. Saga Orchestrator Execution Lifecycle", () => {
    it("executes all steps in forward sequence and persists step checkpoints", async () => {
      const executedOrder: string[] = [];

      const steps: WorkflowStep<{ count: number }>[] = [
        {
          name: "step-one",
          execute: async (ctx) => {
            executedOrder.push("step-one");
            ctx.count += 1;
            return { step1: "done" };
          },
        },
        {
          name: "step-two",
          execute: async (ctx) => {
            executedOrder.push("step-two");
            ctx.count += 10;
            return { step2: "done" };
          },
        },
      ];

      const orchestrator = new SagaOrchestrator("TestWorkflow", steps, store);
      const result = await orchestrator.start("wf-101", { count: 0 });

      expect(result.status).toBe("COMPLETED");
      expect(result.completedSteps).toEqual(["step-one", "step-two"]);
      expect(result.context.count).toBe(11);
      expect(result.stepResults).toEqual({
        "step-one": { step1: "done" },
        "step-two": { step2: "done" },
      });
      expect(executedOrder).toEqual(["step-one", "step-two"]);

      const checkpoint = await store.get("wf-101");
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.status).toBe("COMPLETED");
      expect(checkpoint?.completedSteps).toEqual(["step-one", "step-two"]);
    });

    it("retries transient step failures according to retry policy before succeeding", async () => {
      let callCount = 0;

      const steps: WorkflowStep<{ counter: number }>[] = [
        {
          name: "flaky-step",
          retryPolicy: { maxRetries: 3, backoffMs: 10 },
          execute: async (ctx) => {
            callCount++;
            if (callCount < 3) {
              throw new Error("Temporary network glitch");
            }
            ctx.counter = 42;
            return { success: true };
          },
        },
      ];

      const orchestrator = new SagaOrchestrator("FlakyWorkflow", steps, store);
      const result = await orchestrator.start("wf-flaky-1", { counter: 0 });

      expect(result.status).toBe("COMPLETED");
      expect(callCount).toBe(3);
      expect(result.context.counter).toBe(42);
    });
  });

  // --------------------------------------------------------------------------
  // 2. LIFO Compensatory Rollback Engine
  // --------------------------------------------------------------------------
  describe("2. LIFO Compensatory Rollback Mechanism", () => {
    it("rolls back completed steps in exact reverse (LIFO) order when a downstream step fails", async () => {
      const compensationLog: string[] = [];

      const steps: WorkflowStep<{ value: string }>[] = [
        {
          name: "reserve-funds",
          execute: async () => ({ reserved: 500 }),
          compensate: async () => {
            compensationLog.push("unreserve-funds");
          },
        },
        {
          name: "allocate-stock",
          execute: async () => ({ stockId: "stk-1" }),
          compensate: async () => {
            compensationLog.push("deallocate-stock");
          },
        },
        {
          name: "dispatch-courier",
          execute: async () => {
            throw new Error("Courier API unreachable");
          },
          compensate: async () => {
            compensationLog.push("cancel-courier");
          },
        },
      ];

      const orchestrator = new SagaOrchestrator("OrderSaga", steps, store);
      const result = await orchestrator.start("wf-order-fail", { value: "test" });

      expect(result.status).toBe("COMPENSATED");
      expect(result.completedSteps).toEqual(["reserve-funds", "allocate-stock"]);
      expect(result.compensatedSteps).toEqual(["allocate-stock", "reserve-funds"]);
      expect(result.error).toContain("Courier API unreachable");

      // Verify exact reverse order compensation
      expect(compensationLog).toEqual(["deallocate-stock", "unreserve-funds"]);

      const checkpoint = await store.get("wf-order-fail");
      expect(checkpoint?.status).toBe("COMPENSATED");
      expect(checkpoint?.failedStep).toBe("dispatch-courier");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Crash Recovery & Resumption from Checkpoints
  // --------------------------------------------------------------------------
  describe("3. Crash Recovery & Checkpoint Resumption", () => {
    it("resumes an interrupted workflow from the exact point of crash without re-executing completed steps", async () => {
      const executedSteps: string[] = [];

      const steps: WorkflowStep<{ progress: number }>[] = [
        {
          name: "phase-one",
          execute: async (ctx) => {
            executedSteps.push("phase-one");
            ctx.progress = 1;
            return { one: true };
          },
        },
        {
          name: "phase-two",
          execute: async (ctx) => {
            executedSteps.push("phase-two");
            ctx.progress = 2;
            return { two: true };
          },
        },
        {
          name: "phase-three",
          execute: async (ctx) => {
            executedSteps.push("phase-three");
            ctx.progress = 3;
            return { three: true };
          },
        },
      ];

      // Simulate a crashed execution that completed phase-one and persisted checkpoint
      await store.save({
        workflowId: "crashed-wf-100",
        workflowName: "ResumableWorkflow",
        status: "RUNNING",
        context: { progress: 1 },
        stepResults: { "phase-one": { one: true } },
        completedSteps: ["phase-one"],
        compensatedSteps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new SagaOrchestrator("ResumableWorkflow", steps, store);
      const result = await orchestrator.resume("crashed-wf-100");

      expect(result.status).toBe("COMPLETED");
      expect(result.completedSteps).toEqual(["phase-one", "phase-two", "phase-three"]);
      expect(result.context.progress).toBe(3);

      // Verify step 'phase-one' was NOT re-executed
      expect(executedSteps).toEqual(["phase-two", "phase-three"]);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Month-End Billing Multi-Step Workflow Saga
  // --------------------------------------------------------------------------
  describe("4. Month-End Billing Workflow Saga", () => {
    it("successfully runs complete month-end billing saga and cleanly releases lock", async () => {
      const workflow = createMonthEndBillingWorkflow(
        {
          auditMeterReadings: async () => 145,
          generateBillDrafts: async () => ["draft-1", "draft-2", "draft-3"],
          finalizeInvoices: async (draftIds) => ({
            invoiceIds: draftIds.map((d) => `INV-${d}`),
            outboxIds: draftIds.map((d) => `outbox-${d}`),
          }),
        },
        store
      );

      const context: MonthEndBillingContext = {
        periodId: "p-2026-08",
        yearMonth: "2026-08",
        actorId: "finance-admin-1",
      };

      const result = await workflow.start("billing-wf-success-1", context);

      expect(result.status).toBe("COMPLETED");
      expect(result.completedSteps).toHaveLength(5);
      expect(result.context.auditedReadingsCount).toBe(145);
      expect(result.context.draftBillIds).toEqual(["draft-1", "draft-2", "draft-3"]);
      expect(result.context.finalizedInvoiceIds).toEqual(["INV-draft-1", "INV-draft-2", "INV-draft-3"]);
      expect(result.context.lockHandle).toBeNull(); // Cleanly released
    });

    it("compensates by rolling back draft bills and releasing distributed lock if finalization fails", async () => {
      let rolledBackDrafts: string[] = [];

      const workflow = createMonthEndBillingWorkflow(
        {
          auditMeterReadings: async () => 50,
          generateBillDrafts: async () => ["draft-a", "draft-b"],
          rollbackDrafts: async (drafts) => {
            rolledBackDrafts = [...drafts];
          },
          finalizeInvoices: async () => {
            throw new Error("Financial ledger posting failed");
          },
        },
        store
      );

      const context: MonthEndBillingContext = {
        periodId: "p-2026-09",
        yearMonth: "2026-09",
        actorId: "finance-admin-1",
      };

      const result = await workflow.start("billing-wf-fail-1", context);

      expect(result.status).toBe("COMPENSATED");
      expect(result.completedSteps).toContain("acquire-billing-lock");
      expect(result.completedSteps).toContain("generate-bill-drafts");
      expect(result.compensatedSteps).toContain("generate-bill-drafts");
      expect(result.compensatedSteps).toContain("acquire-billing-lock");

      // Verify draft bills were rolled back
      expect(rolledBackDrafts).toEqual(["draft-a", "draft-b"]);
      expect(result.context.rolledBackBillIds).toEqual(["draft-a", "draft-b"]);
      expect(result.context.lockHandle).toBeNull(); // Mutex lock was compensated and released
    });
  });

  // --------------------------------------------------------------------------
  // 5. Fuel Replenishment Workflow Saga
  // --------------------------------------------------------------------------
  describe("5. Fuel Replenishment Workflow Saga", () => {
    it("successfully posts stock and emits outbox events on valid fuel delivery", async () => {
      const workflow = createFuelReplenishmentWorkflow(
        {
          validateTicket: async () => true,
          checkTankCapacity: async () => ({ currentStock: 2000, capacity: 10000 }),
          postStockAdjustment: async (tankId, liters) => ({ ledgerId: `stk-ledger-1` }),
          emitOutboxEvent: async () => ({ outboxId: "outbox-10" }),
        },
        store
      );

      const context: ReplenishmentContext = {
        replenishmentId: "rep-001",
        tankId: "tank-north-1",
        supplierId: "ceypetco",
        liters: 3500,
        costPerLiterCents: 37000,
        totalCostCents: 129500000,
        batchTicketNumber: "CEY-2026-9901",
      };

      const result = await workflow.start("replenish-wf-1", context);

      expect(result.status).toBe("COMPLETED");
      expect(result.context.stockLedgerId).toBe("stk-ledger-1");
      expect(result.context.outboxMessageId).toBe("outbox-10");
      expect(result.context.tankLockHandle).toBeNull(); // Tank lock cleanly released
    });

    it("triggers compensatory stock reversal when outbox emission fails during delivery", async () => {
      let rollbackReversalId: string | null = null;
      let rollbackLiters = 0;

      const workflow = createFuelReplenishmentWorkflow(
        {
          validateTicket: async () => true,
          checkTankCapacity: async () => ({ currentStock: 1000, capacity: 10000 }),
          postStockAdjustment: async () => ({ ledgerId: `stk-ledger-2` }),
          rollbackStockAdjustment: async (tankId, liters) => {
            rollbackLiters = liters;
            rollbackReversalId = `rev-stk-ledger-2`;
            return { reversalLedgerId: `rev-stk-ledger-2` };
          },
          emitOutboxEvent: async (type) => {
            if (type === "FuelReplenished") {
              throw new Error("Kafka cluster unavailable");
            }
            return { outboxId: "void-outbox" };
          },
        },
        store
      );

      const context: ReplenishmentContext = {
        replenishmentId: "rep-002",
        tankId: "tank-south-2",
        supplierId: "ceypetco",
        liters: 4000,
        costPerLiterCents: 37000,
        totalCostCents: 148000000,
        batchTicketNumber: "CEY-2026-9902",
      };

      const result = await workflow.start("replenish-wf-fail", context);

      expect(result.status).toBe("COMPENSATED");
      expect(result.completedSteps).toContain("post-fuel-stock");
      expect(result.compensatedSteps).toContain("post-fuel-stock");
      expect(result.compensatedSteps).toContain("reserve-tank-capacity");

      // Verify compensatory stock reversal occurred
      expect(rollbackLiters).toBe(4000);
      expect(rollbackReversalId).toBe("rev-stk-ledger-2");
      expect(result.context.compensatedAdjustments).toEqual(["rev-stk-ledger-2"]);
      expect(result.context.tankLockHandle).toBeNull(); // Tank lock was compensated and released
    });

    it("aborts before reserving capacity if delivery ticket number is missing", async () => {
      const workflow = createFuelReplenishmentWorkflow({}, store);

      const context: ReplenishmentContext = {
        replenishmentId: "rep-003",
        tankId: "tank-south-2",
        supplierId: "ceypetco",
        liters: 1000,
        costPerLiterCents: 37000,
        totalCostCents: 37000000,
        batchTicketNumber: "", // Invalid: empty ticket
      };

      const result = await workflow.start("replenish-wf-invalid-ticket", context);

      expect(result.status).toBe("COMPENSATED");
      expect(result.error).toContain("Missing batch ticket number");
      expect(result.completedSteps).toHaveLength(0); // Zero steps completed
    });
  });
});
