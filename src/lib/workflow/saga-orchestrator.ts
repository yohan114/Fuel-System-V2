// ============================================================================
// Phase 16 — Durable Saga Workflow Orchestrator
// Reference: Fuel-System-V3 Plan Section 21 (Phase 16 — Durable Workflows with Temporal)
//
// Implements deterministic state machine execution, step-level checkpointing,
// crash-recovery resume, and automatic LIFO compensatory rollbacks.
// ============================================================================

import type {
  IWorkflowStore,
  WorkflowCheckpoint,
  WorkflowExecutionResult,
  WorkflowStep,
} from "./types";
import { defaultWorkflowStore } from "./types";

export class SagaOrchestrator<TContext = any> {
  constructor(
    public readonly workflowName: string,
    private steps: WorkflowStep<TContext>[],
    private store: IWorkflowStore = defaultWorkflowStore
  ) {}

  /**
   * Starts a new durable workflow execution with an initial context.
   */
  async start(
    workflowId: string,
    initialContext: TContext
  ): Promise<WorkflowExecutionResult<TContext>> {
    const startTime = Date.now();

    // Check if an execution already exists
    const existing = await this.store.get(workflowId);
    if (existing && existing.status === "COMPLETED") {
      return {
        workflowId: existing.workflowId,
        workflowName: this.workflowName,
        status: existing.status,
        context: existing.context,
        completedSteps: existing.completedSteps,
        compensatedSteps: existing.compensatedSteps,
        stepResults: existing.stepResults,
        durationMs: 0,
      };
    }

    const checkpoint: WorkflowCheckpoint<TContext> = {
      workflowId,
      workflowName: this.workflowName,
      status: "RUNNING",
      context: initialContext,
      stepResults: {},
      completedSteps: [],
      compensatedSteps: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.store.save(checkpoint);
    return this.runWorkflow(checkpoint, startTime);
  }

  /**
   * Resumes a previously interrupted or suspended workflow from its last checkpoint.
   */
  async resume(workflowId: string): Promise<WorkflowExecutionResult<TContext>> {
    const startTime = Date.now();
    const checkpoint = await this.store.get(workflowId);

    if (!checkpoint) {
      throw new Error(`Workflow with ID ${workflowId} was not found in checkpoint store`);
    }

    if (checkpoint.status === "COMPLETED" || checkpoint.status === "COMPENSATED") {
      return {
        workflowId: checkpoint.workflowId,
        workflowName: this.workflowName,
        status: checkpoint.status,
        context: checkpoint.context,
        completedSteps: checkpoint.completedSteps,
        compensatedSteps: checkpoint.compensatedSteps,
        stepResults: checkpoint.stepResults,
        error: checkpoint.error,
        durationMs: 0,
      };
    }

    checkpoint.status = "RUNNING";
    checkpoint.updatedAt = new Date();
    await this.store.save(checkpoint);

    return this.runWorkflow(checkpoint, startTime);
  }

  /**
   * Main step execution loop with checkpointing and compensation triggers.
   */
  private async runWorkflow(
    checkpoint: WorkflowCheckpoint<TContext>,
    startTime: number
  ): Promise<WorkflowExecutionResult<TContext>> {
    for (const step of this.steps) {
      // Skip steps that were already completed and checkpointed
      if (checkpoint.completedSteps.includes(step.name)) {
        continue;
      }

      let attempts = 0;
      const maxRetries = step.retryPolicy?.maxRetries ?? 0;
      const backoffMs = step.retryPolicy?.backoffMs ?? 50;

      let stepSucceeded = false;

      while (!stepSucceeded) {
        try {
          const output = await step.execute(checkpoint.context);
          checkpoint.stepResults[step.name] = output !== undefined ? output : true;
          checkpoint.completedSteps.push(step.name);
          checkpoint.updatedAt = new Date();
          await this.store.save(checkpoint);
          stepSucceeded = true;
        } catch (err: any) {
          attempts++;
          if (attempts <= maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs * attempts));
            continue;
          }

          // Step unrecoverably failed -> Trigger Saga Compensations
          checkpoint.failedStep = step.name;
          checkpoint.error = err instanceof Error ? err.message : String(err);
          checkpoint.status = "COMPENSATING";
          checkpoint.updatedAt = new Date();
          await this.store.save(checkpoint);

          await this.compensateWorkflow(checkpoint);

          checkpoint.status = "COMPENSATED";
          checkpoint.updatedAt = new Date();
          await this.store.save(checkpoint);

          return {
            workflowId: checkpoint.workflowId,
            workflowName: this.workflowName,
            status: "COMPENSATED",
            context: checkpoint.context,
            completedSteps: checkpoint.completedSteps,
            compensatedSteps: checkpoint.compensatedSteps,
            stepResults: checkpoint.stepResults,
            error: checkpoint.error,
            durationMs: Date.now() - startTime,
          };
        }
      }
    }

    // All steps executed successfully
    checkpoint.status = "COMPLETED";
    checkpoint.updatedAt = new Date();
    await this.store.save(checkpoint);

    return {
      workflowId: checkpoint.workflowId,
      workflowName: this.workflowName,
      status: "COMPLETED",
      context: checkpoint.context,
      completedSteps: checkpoint.completedSteps,
      compensatedSteps: checkpoint.compensatedSteps,
      stepResults: checkpoint.stepResults,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Executes compensatory actions in reverse chronological order (LIFO).
   */
  private async compensateWorkflow(
    checkpoint: WorkflowCheckpoint<TContext>
  ): Promise<void> {
    const stepsToCompensate = [...checkpoint.completedSteps].reverse();

    for (const stepName of stepsToCompensate) {
      const stepDef = this.steps.find((s) => s.name === stepName);
      if (stepDef && stepDef.compensate) {
        try {
          const stepOutput = checkpoint.stepResults[stepName];
          await stepDef.compensate(checkpoint.context, stepOutput);
          checkpoint.compensatedSteps.push(stepName);
          checkpoint.updatedAt = new Date();
          await this.store.save(checkpoint);
        } catch (compErr) {
          console.error(
            `[SagaOrchestrator] Compensation failed for step '${stepName}' in workflow '${this.workflowName}':`,
            compErr
          );
        }
      }
    }
  }
}
