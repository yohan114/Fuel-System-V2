// ============================================================================
// NestJS Fuel Module: Data Transfer Objects
// Reference: Fuel-System-V3 Plan Section 11 (Modular Monolith)
// ============================================================================

export interface IssueFuelDto {
  assetIdOrCode: string;
  fuelKind: string;
  litres: number;
  issueDate?: string | Date;
  meterReading?: number | null;
  readingType?: string | null;
  bulkTankId?: string | null;
  driverName?: string | null;
  fuelRequestId?: string | null;
  idempotencyKey?: string | null;
  source?: string | null;
}

export interface VoidFuelIssueDto {
  issueId: string;
  reason: string;
}
