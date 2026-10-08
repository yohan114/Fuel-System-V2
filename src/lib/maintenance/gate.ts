// ============================================================================
// CUT-01: Maintenance Mode & Write-Freeze Gate (Master Plan Section 14)
// Prevents database mutations during cutover rehearsal or migration windows,
// enforcing strict read-only operation while allowing diagnostic reads.
// ============================================================================

export interface MaintenanceState {
  active: boolean;
  reason?: string | null;
  startedAt?: Date | null;
  scheduledEndAt?: Date | null;
}

let maintenanceState: MaintenanceState = {
  active: false,
  reason: null,
  startedAt: null,
  scheduledEndAt: null,
};

/**
 * Checks whether the system is currently in read-only maintenance mode.
 */
export function isMaintenanceModeActive(): boolean {
  if (maintenanceState.active) {
    return true;
  }
  return process.env.MAINTENANCE_MODE === "true";
}

/**
 * Returns current maintenance state details.
 */
export function getMaintenanceState(): MaintenanceState {
  return { ...maintenanceState };
}

/**
 * Enables or disables maintenance mode (for administrative / rehearsal operations).
 */
export function setMaintenanceMode(
  active: boolean,
  reason: string = "Scheduled ERP Cutover Maintenance Window"
): void {
  maintenanceState = {
    active,
    reason: active ? reason : null,
    startedAt: active ? new Date() : null,
    scheduledEndAt: active ? new Date(Date.now() + 60 * 60 * 1000) : null,
  };
}

/**
 * Asserts that the system is not in maintenance mode. Throws if writes are frozen.
 */
export function assertNotMaintenanceMode(): void {
  if (isMaintenanceModeActive()) {
    const reason = maintenanceState.reason || "Scheduled database maintenance window";
    throw new Error(`MAINTENANCE_WINDOW_ACTIVE: System is read-only. ${reason}`);
  }
}
