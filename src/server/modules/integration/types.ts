// ============================================================================
// Phase 19 / Wave F: General Ledger (GL) Export & Integration Contracts
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Defines Standard Chart of Accounts, Double-Entry Journal Lines,
// Trial Balance Zero-Imbalance verification, and Corporate ERP CSV export formats.
// ============================================================================

export const CHART_OF_ACCOUNTS = {
  CASH_AND_BANK: { code: "1110", name: "Cash and Bank Balances", type: "ASSET" },
  ACCOUNTS_RECEIVABLE: { code: "1200", name: "Trade Accounts Receivable", type: "ASSET" },
  FUEL_INVENTORY: { code: "1310", name: "Bulk Fuel Inventory", type: "ASSET" },
  PARTS_INVENTORY: { code: "1320", name: "Spare Parts & Lubricants Inventory", type: "ASSET" },
  ACCOUNTS_PAYABLE: { code: "2100", name: "Trade Accounts Payable", type: "LIABILITY" },
  HIRE_REVENUE: { code: "4100", name: "Plant & Equipment Hire Revenue", type: "REVENUE" },
  FUEL_REVENUE: { code: "4200", name: "Fuel Dispensing Revenue", type: "REVENUE" },
  FUEL_OPERATING_EXPENSE: { code: "5100", name: "Equipment Fuel Operating Expense", type: "EXPENSE" },
  MAINTENANCE_EXPENSE: { code: "5200", name: "Vehicle Maintenance & Repair Expense", type: "EXPENSE" },
  WORKSHOP_LABOR_CLEARING: { code: "5300", name: "Internal Workshop Labor Clearing", type: "EXPENSE_CONTRA" },
} as const;

export type GLSourceModule =
  | "FUEL"
  | "PROCUREMENT"
  | "BILLING"
  | "FINANCE"
  | "MAINTENANCE"
  | "COMBINED";

export interface JournalEntryLine {
  id: string;
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  description: string;
  referenceId?: string;
  entityId?: string;
}

export interface JournalBatch {
  id: string;
  batchNumber: string;
  period: string; // e.g. "2026-08"
  sourceModule: GLSourceModule;
  lines: JournalEntryLine[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  isBalanced: boolean;
  postedAt: Date;
  postedBy: string;
  exportedAt?: Date;
  notes?: string;
}

export interface GenerateJournalBatchDto {
  period: string;
  sourceModule?: GLSourceModule;
  fuelIssues?: Array<{ id: string; costCents: number; assetId: string }>;
  fuelReceipts?: Array<{ id: string; costCents: number; supplierId: string }>;
  invoices?: Array<{ id: string; hireCents: number; fuelCents: number; customerId: string }>;
  payments?: Array<{ id: string; amountCents: number; customerId: string }>;
  maintenanceWorkOrders?: Array<{ id: string; partsCostCents: number; laborCostCents: number; assetId: string }>;
  notes?: string;
}

export interface GLExportResult {
  batchId: string;
  batchNumber: string;
  format: "CSV" | "JSON";
  csvContent?: string;
  jsonData?: JournalBatch;
  recordCount: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
}
