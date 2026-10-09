// ============================================================================
// Phase 19 / Wave F: Multi-Site Inventory & Stock Movement Contracts
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Defines Warehouse locations, Stock on hand, Append-only Ledger entries,
// Inter-site Transfers, and Direct Issue-to-Asset contracts.
// ============================================================================

export type ItemCategory = "FUEL" | "LUBRICANT" | "FILTER" | "SPARE_PART" | "CONSUMABLE";

export type StockMovementType =
  | "RECEIPT"
  | "ISSUE_TO_ASSET"
  | "TRANSFER_DISPATCH"
  | "TRANSFER_RECEIPT"
  | "AUDIT_ADJUSTMENT"
  | "RETURN";

export type TransferStatus = "DISPATCHED" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export interface InventoryItem {
  id: string;
  itemCode: string;
  name: string;
  category: ItemCategory;
  unit: string;
  standardCostCents: number;
  reorderThreshold: number;
  reorderQuantity: number;
}

export interface WarehouseLocation {
  id: string;
  code: string;
  name: string;
  siteId: string;
  isMobile: boolean;
}

export interface StockLevel {
  locationId: string;
  itemCode: string;
  quantityOnHand: number;
  quantityAllocated: number;
  quantityAvailable: number;
  updatedAt: Date;
}

export interface StockLedgerEntry {
  id: string;
  timestamp: Date;
  movementType: StockMovementType;
  itemCode: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  assetId?: string;
  workOrderId?: string;
  referenceId?: string;
  performedBy: string;
  notes?: string;
}

export interface InterSiteTransfer {
  id: string;
  transferNumber: string;
  sourceLocationId: string;
  destinationLocationId: string;
  itemCode: string;
  quantityDispatched: number;
  quantityReceived?: number;
  status: TransferStatus;
  dispatchedAt: Date;
  dispatchedBy: string;
  receivedAt?: Date;
  receivedBy?: string;
  notes?: string;
}

export interface ReorderAlert {
  locationId: string;
  itemCode: string;
  itemName: string;
  currentAvailable: number;
  reorderThreshold: number;
  suggestedReorderQuantity: number;
  estimatedCostCents: number;
}

export interface IssueStockToAssetDto {
  locationId: string;
  itemCode: string;
  quantity: number;
  assetId: string;
  workOrderId?: string;
  notes?: string;
}

export interface DispatchTransferDto {
  sourceLocationId: string;
  destinationLocationId: string;
  itemCode: string;
  quantity: number;
  notes?: string;
}

export interface ReceiveTransferDto {
  transferId: string;
  quantityReceived?: number;
  notes?: string;
}

export interface AuditAdjustmentDto {
  locationId: string;
  itemCode: string;
  physicalCount: number;
  reason: string;
}
