// ============================================================================
// Phase 19 / Wave F: Procurement & Supplier Receipt Contracts
// Reference: Fuel-System-V3 Plan Section 24 (Phase 19) & Wave F (ERP Expansion)
//
// Defines Purchase Orders, Goods Receipt Notes (GRN), Supplier delivery tickets,
// and Three-Way Matching domain contracts.
// ============================================================================

export type PurchaseOrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export type ItemCategory = "FUEL" | "LUBRICANT" | "FILTER" | "SPARE_PART";

export type MatchingStatus = "PERFECT_MATCH" | "TOLERANCE_ACCEPTED" | "DISCREPANCY";

export interface PurchaseOrderLine {
  id: string;
  itemCategory: ItemCategory;
  itemCode: string;
  description: string;
  orderedQuantity: number;
  unit: string;
  unitPriceCents: number;
  totalCostCents: number;
  receivedQuantity: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  siteId: string;
  status: PurchaseOrderStatus;
  orderedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
  currency: string;
  totalAmountCents: number;
  lineItems: PurchaseOrderLine[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoodsReceiptLine {
  id: string;
  poLineId: string;
  itemCode: string;
  deliveredQuantity: number;
  unit: string;
  temperatureC?: number;
  density?: number;
  acceptedQuantity: number;
  rejectedQuantity?: number;
  rejectionReason?: string;
}

export interface GoodsReceiptNote {
  id: string;
  grnNumber: string;
  purchaseOrderId: string;
  supplierId: string;
  siteId: string;
  tankId?: string;
  batchTicketNumber: string;
  receivedAt: Date;
  receivedBy: string;
  items: GoodsReceiptLine[];
  totalAcceptedQuantity: number;
  notes?: string;
  createdAt: Date;
}

export interface ThreeWayMatchResult {
  purchaseOrderId: string;
  grnId: string;
  matchStatus: MatchingStatus;
  orderedTotalCents: number;
  receivedCalculatedCents: number;
  varianceCents: number;
  variancePercentage: number;
  toleranceAllowedPercentage: number;
  discrepancies: Array<{
    poLineId: string;
    itemCode: string;
    orderedQty: number;
    receivedQty: number;
    varianceQty: number;
    reason: string;
  }>;
}

export interface CreatePurchaseOrderDto {
  supplierId: string;
  supplierName: string;
  siteId: string;
  currency?: string;
  notes?: string;
  lineItems: Array<{
    itemCategory: ItemCategory;
    itemCode: string;
    description: string;
    orderedQuantity: number;
    unit: string;
    unitPriceCents: number;
  }>;
}

export interface ApprovePurchaseOrderDto {
  poId: string;
  notes?: string;
}

export interface CreateGoodsReceiptDto {
  purchaseOrderId: string;
  siteId: string;
  tankId?: string;
  batchTicketNumber: string;
  notes?: string;
  items: Array<{
    poLineId: string;
    itemCode: string;
    deliveredQuantity: number;
    unit: string;
    temperatureC?: number;
    density?: number;
    rejectedQuantity?: number;
    rejectionReason?: string;
  }>;
}
