// ============================================================================
// Phase 16 — Durable Workflows & Saga Orchestrator Contracts
// Reference: Fuel-System-V3 Plan Section 21 (Phase 16 — Durable Workflows with Temporal)
//
// Defines deterministic workflow state machines, step lifecycles,
// compensatory rollback contracts, and checkpoint persistence interfaces.
// ============================================================================

export type WorkflowStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPENSATED"
  | "SUSPENDED";

export type WorkflowStepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATED"
  | "SKIPPED";

export interface StepRetryPolicy {
  maxRetries: number;
  backoffMs?: number;
}

export interface WorkflowStep<TContext = any, TOutput = any> {
  name: string;
  execute: (context: TContext) => Promise<TOutput>;
  compensate?: (context: TContext, output?: TOutput) => Promise<void>;
  timeoutMs?: number;
  retryPolicy?: StepRetryPolicy;
}

export interface WorkflowCheckpoint<TContext = any> {
  workflowId: string;
  workflowName: string;
  status: WorkflowStatus;
  context: TContext;
  stepResults: Record<string, any>;
  completedSteps: string[];
  failedStep?: string;
  compensatedSteps: string[];
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

export interface WorkflowExecutionResult<TContext = any> {
  workflowId: string;
  workflowName: string;
  status: WorkflowStatus;
  context: TContext;
  completedSteps: string[];
  compensatedSteps: string[];
  stepResults: Record<string, any>;
  error?: string;
  durationMs: number;
}

/**
 * Interface for durable workflow checkpoint persistence.
 * Compatible with PostgreSQL, Redis, or In-Memory storage.
 */
export interface IWorkflowStore {
  save(checkpoint: WorkflowCheckpoint): Promise<void>;
  get(workflowId: string): Promise<WorkflowCheckpoint | null>;
  list(workflowName?: string): Promise<WorkflowCheckpoint[]>;
  delete(workflowId: string): Promise<void>;
}

/**
 * In-Memory Workflow Checkpoint Store
 * Provides instant persistence, checkpoint inspection, and zero external dependencies
 * for deterministic unit testing and local execution.
 */
export class InMemoryWorkflowStore implements IWorkflowStore {
  private checkpoints = new Map<string, WorkflowCheckpoint>();

  async save(checkpoint: WorkflowCheckpoint): Promise<void> {
    // Clone to prevent shared reference mutations
    const cloned: WorkflowCheckpoint = JSON.parse(JSON.stringify(checkpoint));
    cloned.createdAt = new Date(checkpoint.createdAt);
    cloned.updatedAt = new Date(checkpoint.updatedAt);
    this.checkpoints.set(checkpoint.workflowId, cloned);
  }

  async get(workflowId: string): Promise<WorkflowCheckpoint | null> {
    const cp = this.checkpoints.get(workflowId);
    if (!cp) return null;
    const cloned: WorkflowCheckpoint = JSON.parse(JSON.stringify(cp));
    cloned.createdAt = new Date(cp.createdAt);
    cloned.updatedAt = new Date(cp.updatedAt);
    return cloned;
  }

  async list(workflowName?: string): Promise<WorkflowCheckpoint[]> {
    const all = Array.from(this.checkpoints.values());
    if (workflowName) {
      return all.filter((cp) => cp.workflowName === workflowName);
    }
    return all;
  }

  async delete(workflowId: string): Promise<void> {
    this.checkpoints.delete(workflowId);
  }

  clear(): void {
    this.checkpoints.clear();
  }
}

export const defaultWorkflowStore = new InMemoryWorkflowStore();
