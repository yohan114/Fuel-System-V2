// Authoritative Fuel Single-Writer Gateway (Task API-02 / Wave D)
// Reference: Master Plan Section 8 (Posting Workflows) & Section 10 (Backend Replacement)

import {
  executeIssueFuel,
  executeVoidFuelIssue,
  IssueFuelCommand,
  IssueFuelResult,
  VoidFuelIssueCommand,
  VoidFuelIssueResult,
  CommandContext,
  CommandResult,
} from "@/lib/commands";
import type { Rfc7807ProblemDetails } from "@/lib/api/respond";

export type FuelWriteAuthorityMode = "LOCAL_COMMAND" | "REMOTE_API";

let testOverrideAuthority: FuelWriteAuthorityMode | null = null;

/**
 * Resolves the active authoritative writer for fuel transactions.
 * Prevents split-brain dual writing by ensuring exactly one backend writes fuel state.
 */
export function getFuelWriteAuthority(): FuelWriteAuthorityMode {
  if (testOverrideAuthority) {
    return testOverrideAuthority;
  }
  return (process.env.FUEL_WRITE_AUTHORITY as FuelWriteAuthorityMode) || "LOCAL_COMMAND";
}

/**
 * Sets the authoritative write mode for testing purposes.
 */
export function setFuelWriteAuthorityForTesting(mode: FuelWriteAuthorityMode | null): void {
  testOverrideAuthority = mode;
}

/**
 * Dispatches an IssueFuel mutation through the authoritative writer.
 *
 * Mode LOCAL_COMMAND: Executes within local database transaction with atomic stock decrement.
 * Mode REMOTE_API: Forwards request to ASP.NET Core backend (.NET 10 LTS) with X-Idempotency-Key
 *                  and parses RFC 7807 Problem Details on rejection.
 */
export async function dispatchIssueFuel(
  cmd: IssueFuelCommand,
  ctx: CommandContext
): Promise<CommandResult<IssueFuelResult>> {
  const authority = getFuelWriteAuthority();

  if (authority === "REMOTE_API") {
    return dispatchRemoteIssueFuel(cmd, ctx);
  }

  return executeIssueFuel(cmd, ctx);
}

/**
 * Dispatches a VoidFuelIssue mutation through the authoritative writer.
 */
export async function dispatchVoidFuelIssue(
  cmd: VoidFuelIssueCommand,
  ctx: CommandContext
): Promise<CommandResult<VoidFuelIssueResult>> {
  const authority = getFuelWriteAuthority();

  if (authority === "REMOTE_API") {
    return dispatchRemoteVoidFuelIssue(cmd, ctx);
  }

  return executeVoidFuelIssue(cmd, ctx);
}

// ----------------------------------------------------------------------------
// Remote Gateway Delegation (.NET 10 LTS Backend)
// ----------------------------------------------------------------------------

async function dispatchRemoteIssueFuel(
  cmd: IssueFuelCommand,
  ctx: CommandContext
): Promise<CommandResult<IssueFuelResult>> {
  const baseUrl = process.env.REMOTE_ERP_API_URL || "http://localhost:5000";
  const endpoint = `${baseUrl}/api/v1/fuel/issues`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, application/problem+json",
    "X-Actor-Id": ctx.actorId,
    "X-Actor-Role": ctx.role,
  };

  if (ctx.projectId) headers["X-Project-Id"] = ctx.projectId;
  if (ctx.bulkTankId) headers["X-Tank-Id"] = ctx.bulkTankId;
  if (cmd.idempotencyKey) headers["X-Idempotency-Key"] = cmd.idempotencyKey;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assetIdOrCode: cmd.assetIdOrCode,
        fuelKind: cmd.fuelKind,
        litres: cmd.litres,
        bulkTankId: cmd.bulkTankId ?? null,
        projectId: ctx.projectId ?? null,
        meterReading: cmd.meterReading ?? null,
        readingType: cmd.readingType ?? null,
        driverName: cmd.driverName ?? null,
        slipNumber: null,
        notes: null,
        sourceType: cmd.source ?? null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        data: {
          issueId: data.issueId,
          assetCode: data.assetCode || cmd.assetIdOrCode,
          litres: data.litres || cmd.litres,
          fuelKind: cmd.fuelKind,
          totalCost: data.totalCost || 0,
          pricePerLitre: data.unitPrice || 0,
          bulkTankName: data.bulkTankName ?? null,
        },
      };
    }

    // Handle RFC 7807 Problem Details
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("problem+json") || contentType.includes("json")) {
      const problem = (await res.json()) as Rfc7807ProblemDetails;
      return {
        success: false,
        error: problem.detail || problem.title || "Remote command rejected",
        code: problem.code || `HTTP_${res.status}`,
      };
    }

    return {
      success: false,
      error: `Remote API error (${res.status} ${res.statusText})`,
      code: `HTTP_${res.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to connect to authoritative backend",
      code: "REMOTE_GATEWAY_ERROR",
    };
  }
}

async function dispatchRemoteVoidFuelIssue(
  cmd: VoidFuelIssueCommand,
  ctx: CommandContext
): Promise<CommandResult<VoidFuelIssueResult>> {
  const baseUrl = process.env.REMOTE_ERP_API_URL || "http://localhost:5000";
  const endpoint = `${baseUrl}/api/v1/fuel/issues/${cmd.issueId}/void`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, application/problem+json",
    "X-Actor-Id": ctx.actorId,
    "X-Actor-Role": ctx.role,
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: cmd.reason }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        data: {
          issueId: data.issueId || cmd.issueId,
          assetCode: data.assetCode || "",
          litres: data.restoredLitres || 0,
          voided: true,
          tankDeltaLitres: data.restoredLitres || 0,
          tankName: data.tankName ?? null,
          billNote: data.billNote || "",
        },
      };
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("problem+json") || contentType.includes("json")) {
      const problem = (await res.json()) as Rfc7807ProblemDetails;
      return {
        success: false,
        error: problem.detail || problem.title || "Remote void rejected",
        code: problem.code || `HTTP_${res.status}`,
      };
    }

    return {
      success: false,
      error: `Remote API error (${res.status} ${res.statusText})`,
      code: `HTTP_${res.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to connect to authoritative backend",
      code: "REMOTE_GATEWAY_ERROR",
    };
  }
}
