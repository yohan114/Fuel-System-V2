// ============================================================================
// Phase 16 — Fuel Stock Replenishment Durable Workflow Saga
// Reference: Fuel-System-V3 Plan Section 21 (Phase 16 — Durable Workflows with Temporal)
//
// Orchestrates multi-step fuel delivery receipt with compensatory rollbacks:
// 1. validate-delivery-ticket (comp: none)
// 2. reserve-tank-capacity (comp: release-tank-lock)
// 3. post-fuel-stock (comp: post compensating negative stock adjustment)
// 4. emit-replenishment-outbox (comp: emit outbox void event)
// 5. release-tank-lock (comp: none)
// ============================================================================

import {
  acquireDistributedLock,
  releaseDistributedLock,
  type LockHandle,
} from "@/lib/cache/distributed-lock";
import { SagaOrchestrator } from "./saga-orchestrator";
import type { IWorkflowStore, WorkflowStep } from "./types";
import { defaultWorkflowStore } from "./types";

export interface ReplenishmentContext {
  replenishmentId: string;
  tankId: string;
  supplierId: string;
  liters: number;
  costPerLiterCents: number;
  totalCostCents: number;
  batchTicketNumber: string;
  tankLockHandle?: LockHandle | null;
  stockLedgerId?: string;
  outboxMessageId?: string;
  compensatedAdjustments?: string[];
}

export interface ReplenishmentWorkflowDelegates {
  validateTicket?: (ticket: string, supplierId: string) => Promise<boolean>;
  checkTankCapacity?: (tankId: string, incomingLiters: number) => Promise<{ currentStock: number; capacity: number }>;
  postStockAdjustment?: (tankId: string, liters: number, context: ReplenishmentContext) => Promise<{ ledgerId: string }>;
  rollbackStockAdjustment?: (tankId: string, liters: number, reason: string) => Promise<{ reversalLedgerId: string }>;
  emitOutboxEvent?: (eventType: string, payload: any) => Promise<{ outboxId: string }>;
}

export function createFuelReplenishmentWorkflow(
  delegates: ReplenishmentWorkflowDelegates = {},
  store: IWorkflowStore = defaultWorkflowStore
): SagaOrchestrator<ReplenishmentContext> {
  const steps: WorkflowStep<ReplenishmentContext>[] = [
    // ------------------------------------------------------------------------
    // Step 1: Validate Delivery Ticket & Supplier Authority
    // ------------------------------------------------------------------------
    {
      name: "validate-delivery-ticket",
      retryPolicy: { maxRetries: 1, backoffMs: 50 },
      execute: async (ctx) => {
        if (!ctx.batchTicketNumber || ctx.batchTicketNumber.trim() === "") {
          throw new Error("Invalid delivery: Missing batch ticket number");
        }
        if (ctx.liters <= 0) {
          throw new Error(`Invalid delivery: Liters must be positive (received: ${ctx.liters})`);
        }

        if (delegates.validateTicket) {
          const valid = await delegates.validateTicket(ctx.batchTicketNumber, ctx.supplierId);
          if (!valid) {
            throw new Error(`Delivery ticket ${ctx.batchTicketNumber} is not valid for supplier ${ctx.supplierId}`);
          }
        }

        return { ticketValid: true, batchTicket: ctx.batchTicketNumber };
      },
    },

    // ------------------------------------------------------------------------
    // Step 2: Reserve Tank Capacity & Acquire Mutex Lock
    // ------------------------------------------------------------------------
    {
      name: "reserve-tank-capacity",
      retryPolicy: { maxRetries: 2, backoffMs: 100 },
      execute: async (ctx) => {
        const lockResource = `tank:stock:${ctx.tankId}`;
        const lock = await acquireDistributedLock(lockResource, {
          ttlMs: 30_000,
          retries: 2,
        });

        if (!lock) {
          throw new Error(`Failed to acquire lock for tank ${ctx.tankId} — tank is being dispensed or audited`);
        }
        ctx.tankLockHandle = lock;

        if (delegates.checkTankCapacity) {
          const { currentStock, capacity } = await delegates.checkTankCapacity(ctx.tankId, ctx.liters);
          if (currentStock + ctx.liters > capacity) {
            throw new Error(
              `Tank capacity overflow: Capacity ${capacity}L exceeded by incoming delivery of ${ctx.liters}L (current stock: ${currentStock}L)`
            );
          }
        }

        return { lockAcquired: true, tankId: ctx.tankId };
      },
      compensate: async (ctx) => {
        if (ctx.tankLockHandle) {
          await releaseDistributedLock(ctx.tankLockHandle);
          ctx.tankLockHandle = null;
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 3: Post Fuel Stock to Tank Ledger
    // ------------------------------------------------------------------------
    {
      name: "post-fuel-stock",
      retryPolicy: { maxRetries: 2, backoffMs: 100 },
      execute: async (ctx) => {
        let ledgerId = `ledger-${ctx.replenishmentId}`;
        if (delegates.postStockAdjustment) {
          const res = await delegates.postStockAdjustment(ctx.tankId, ctx.liters, ctx);
          ledgerId = res.ledgerId;
        }

        ctx.stockLedgerId = ledgerId;
        return { postedLiters: ctx.liters, stockLedgerId: ledgerId };
      },
      compensate: async (ctx) => {
        if (ctx.stockLedgerId) {
          let reversalId = `reversal-${ctx.stockLedgerId}`;
          if (delegates.rollbackStockAdjustment) {
            const res = await delegates.rollbackStockAdjustment(
              ctx.tankId,
              ctx.liters,
              `Saga rollback for failed replenishment ${ctx.replenishmentId}`
            );
            reversalId = res.reversalLedgerId;
          }
          ctx.compensatedAdjustments = [...(ctx.compensatedAdjustments || []), reversalId];
          ctx.stockLedgerId = undefined;
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 4: Emit Outbox Event for Finance & Audit
    // ------------------------------------------------------------------------
    {
      name: "emit-replenishment-outbox",
      retryPolicy: { maxRetries: 2, backoffMs: 100 },
      execute: async (ctx) => {
        let outboxId = `outbox-replenish-${ctx.replenishmentId}`;
        if (delegates.emitOutboxEvent) {
          const res = await delegates.emitOutboxEvent("FuelReplenished", {
            replenishmentId: ctx.replenishmentId,
            tankId: ctx.tankId,
            liters: ctx.liters,
            totalCostCents: ctx.totalCostCents,
          });
          outboxId = res.outboxId;
        }

        ctx.outboxMessageId = outboxId;
        return { outboxId, eventType: "FuelReplenished" };
      },
      compensate: async (ctx) => {
        if (ctx.outboxMessageId && delegates.emitOutboxEvent) {
          await delegates.emitOutboxEvent("FuelReplenishmentVoided", {
            replenishmentId: ctx.replenishmentId,
            reason: "Workflow compensatory rollback",
          });
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 5: Release Tank Mutex Lock
    // ------------------------------------------------------------------------
    {
      name: "release-tank-lock",
      execute: async (ctx) => {
        if (ctx.tankLockHandle) {
          await releaseDistributedLock(ctx.tankLockHandle);
          ctx.tankLockHandle = null;
        }
        return { lockReleased: true };
      },
    },
  ];

  return new SagaOrchestrator<ReplenishmentContext>("FuelReplenishmentWorkflow", steps, store);
}
