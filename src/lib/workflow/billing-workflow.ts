// ============================================================================
// Phase 16 — Month-End Billing Durable Workflow Saga
// Reference: Fuel-System-V3 Plan Section 21 (Phase 16 — Durable Workflows with Temporal)
//
// Orchestrates multi-step monthly billing generation with guaranteed compensations:
// 1. acquire-billing-lock (comp: release-lock)
// 2. audit-meter-readings (comp: none)
// 3. generate-bill-drafts (comp: rollback/delete generated drafts)
// 4. finalize-invoices-and-outbox (comp: void finalized bills and emit void events)
// 5. release-billing-lock (comp: none)
// ============================================================================

import {
  acquireDistributedLock,
  releaseDistributedLock,
  type LockHandle,
} from "@/lib/cache/distributed-lock";
import { SagaOrchestrator } from "./saga-orchestrator";
import type { IWorkflowStore, WorkflowStep } from "./types";
import { defaultWorkflowStore } from "./types";

export interface MonthEndBillingContext {
  periodId: string;
  yearMonth: string; // e.g. "2026-08"
  siteId?: string;
  actorId: string;
  lockHandle?: LockHandle | null;
  auditedReadingsCount?: number;
  draftBillIds?: string[];
  finalizedInvoiceIds?: string[];
  outboxMessageIds?: string[];
  rolledBackBillIds?: string[];
}

export interface BillingWorkflowDelegates {
  auditMeterReadings?: (context: MonthEndBillingContext) => Promise<number>;
  generateBillDrafts?: (context: MonthEndBillingContext) => Promise<string[]>;
  rollbackDrafts?: (billIds: string[]) => Promise<void>;
  finalizeInvoices?: (
    billIds: string[],
    context: MonthEndBillingContext
  ) => Promise<{ invoiceIds: string[]; outboxIds: string[] }>;
  voidFinalizedInvoices?: (invoiceIds: string[]) => Promise<void>;
}

export function createMonthEndBillingWorkflow(
  delegates: BillingWorkflowDelegates = {},
  store: IWorkflowStore = defaultWorkflowStore
): SagaOrchestrator<MonthEndBillingContext> {
  const steps: WorkflowStep<MonthEndBillingContext>[] = [
    // ------------------------------------------------------------------------
    // Step 1: Acquire Distributed Mutex for Billing Period
    // ------------------------------------------------------------------------
    {
      name: "acquire-billing-lock",
      retryPolicy: { maxRetries: 2, backoffMs: 100 },
      execute: async (ctx) => {
        const lockResource = `billing:month-end:${ctx.yearMonth}:${ctx.siteId || "all"}`;
        const lock = await acquireDistributedLock(lockResource, {
          ttlMs: 60_000,
          retries: 1,
        });

        if (!lock) {
          throw new Error(
            `Failed to acquire distributed lock for billing period '${ctx.yearMonth}' — another billing job is currently running`
          );
        }

        ctx.lockHandle = lock;
        return { lockedResource: lockResource, acquiredAt: lock.acquiredAt };
      },
      compensate: async (ctx) => {
        if (ctx.lockHandle) {
          await releaseDistributedLock(ctx.lockHandle);
          ctx.lockHandle = null;
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 2: Audit and Validate Meter Readings
    // ------------------------------------------------------------------------
    {
      name: "audit-meter-readings",
      retryPolicy: { maxRetries: 1, backoffMs: 50 },
      execute: async (ctx) => {
        let count = 0;
        if (delegates.auditMeterReadings) {
          count = await delegates.auditMeterReadings(ctx);
        } else {
          // Default: Simulated meter validation pass
          count = 100;
        }
        ctx.auditedReadingsCount = count;
        return { auditedReadings: count };
      },
      // Read-only step; no compensation required
    },

    // ------------------------------------------------------------------------
    // Step 3: Generate Invoice Drafts
    // ------------------------------------------------------------------------
    {
      name: "generate-bill-drafts",
      retryPolicy: { maxRetries: 1, backoffMs: 100 },
      execute: async (ctx) => {
        let billIds: string[] = [];
        if (delegates.generateBillDrafts) {
          billIds = await delegates.generateBillDrafts(ctx);
        } else {
          billIds = [`draft-bill-${ctx.yearMonth}-1`, `draft-bill-${ctx.yearMonth}-2`];
        }

        ctx.draftBillIds = billIds;
        return { createdDraftsCount: billIds.length, draftIds: billIds };
      },
      compensate: async (ctx) => {
        if (ctx.draftBillIds && ctx.draftBillIds.length > 0) {
          if (delegates.rollbackDrafts) {
            await delegates.rollbackDrafts(ctx.draftBillIds);
          }
          ctx.rolledBackBillIds = [...(ctx.rolledBackBillIds || []), ...ctx.draftBillIds];
          ctx.draftBillIds = [];
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 4: Finalize Invoices & Emit Outbox Events
    // ------------------------------------------------------------------------
    {
      name: "finalize-invoices-and-outbox",
      retryPolicy: { maxRetries: 2, backoffMs: 200 },
      execute: async (ctx) => {
        if (!ctx.draftBillIds || ctx.draftBillIds.length === 0) {
          throw new Error("Cannot finalize invoices: No draft bills were generated");
        }

        let result: { invoiceIds: string[]; outboxIds: string[] };
        if (delegates.finalizeInvoices) {
          result = await delegates.finalizeInvoices(ctx.draftBillIds, ctx);
        } else {
          result = {
            invoiceIds: ctx.draftBillIds.map((id) => id.replace("draft", "inv")),
            outboxIds: ctx.draftBillIds.map((id) => `outbox-${id}`),
          };
        }

        ctx.finalizedInvoiceIds = result.invoiceIds;
        ctx.outboxMessageIds = result.outboxIds;
        return result;
      },
      compensate: async (ctx) => {
        if (ctx.finalizedInvoiceIds && ctx.finalizedInvoiceIds.length > 0) {
          if (delegates.voidFinalizedInvoices) {
            await delegates.voidFinalizedInvoices(ctx.finalizedInvoiceIds);
          }
          ctx.finalizedInvoiceIds = [];
        }
      },
    },

    // ------------------------------------------------------------------------
    // Step 5: Clean Release of Billing Mutex Lock
    // ------------------------------------------------------------------------
    {
      name: "release-billing-lock",
      execute: async (ctx) => {
        if (ctx.lockHandle) {
          await releaseDistributedLock(ctx.lockHandle);
          ctx.lockHandle = null;
        }
        return { lockReleased: true };
      },
    },
  ];

  return new SagaOrchestrator<MonthEndBillingContext>("MonthEndBillingWorkflow", steps, store);
}
