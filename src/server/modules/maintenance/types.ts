// ============================================================================
// Phase 19 / Wave F: Equipment Maintenance & Work Order Costing Contracts
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Defines Work Order lifecycles, Three-Pillar Cost Rollups (Labor, Parts, Sublet),
// Preventative Maintenance (PM) meter trigger evaluations, and Equipment Downtime tracking.
// ============================================================================

export type WorkOrderType =
  | "PREVENTATIVE"
  | "BREAKDOWN"
  | "INSPECTION"
  | "TIRE_SERVICE";

export type WorkOrderStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_PARTS"
  | "COMPLETED"
  | "CLOSED";

export type WorkOrderPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface LaborEntry {
  id: string;
  technicianId: string;
  technicianName: string;
  hours: number;
  hourlyRateCents: number;
  totalCostCents: number;
  date: Date;
  notes?: string;
}

export interface PartsConsumedEntry {
  id: string;
  itemCode: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  inventoryLedgerId?: string;
}

export interface SubletEntry {
  id: string;
  vendorName: string;
  serviceDescription: string;
  invoiceNumber?: string;
  costCents: number;
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  assetId: string;
  assetCode?: string;
  siteId: string;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  description: string;
  meterAtCreation: number;
  meterAtCompletion?: number;
  assignedTechnician?: string;
  laborEntries: LaborEntry[];
  partsConsumed: PartsConsumedEntry[];
  subletEntries: SubletEntry[];
  totalLaborCostCents: number;
  totalPartsCostCents: number;
  totalSubletCostCents: number;
  totalCostCents: number;
  openedAt: Date;
  openedBy: string;
  completedAt?: Date;
  closedAt?: Date;
  closedBy?: string;
  notes?: string;
}

export interface PMIntervalRule {
  id: string;
  category: string;
  serviceName: string; // e.g. "PM 250hr Service", "PM 500hr Service"
  intervalHours: number;
  requiredParts?: Array<{ itemCode: string; quantity: number }>;
}

export interface PMDueEvaluation {
  assetId: string;
  assetCode: string;
  currentMeter: number;
  lastServiceMeter: number;
  nextDueMeter: number;
  hoursRemaining: number;
  isOverdue: boolean;
  pmRuleName: string;
}

export interface CreateWorkOrderDto {
  assetId: string;
  assetCode?: string;
  siteId: string;
  type: WorkOrderType;
  priority?: WorkOrderPriority;
  description: string;
  meterAtCreation: number;
  assignedTechnician?: string;
  notes?: string;
}

export interface AddLaborDto {
  technicianId: string;
  technicianName: string;
  hours: number;
  hourlyRateCents?: number;
  notes?: string;
}

export interface AddPartConsumedDto {
  itemCode: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  inventoryLedgerId?: string;
}

export interface AddSubletDto {
  vendorName: string;
  serviceDescription: string;
  invoiceNumber?: string;
  costCents: number;
}

export interface CompleteWorkOrderDto {
  meterAtCompletion?: number;
  notes?: string;
}

export interface CloseWorkOrderDto {
  supervisorNotes?: string;
}
