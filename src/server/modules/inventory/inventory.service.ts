// ============================================================================
// Phase 19 / Wave F: Multi-Site Inventory Domain Application Service
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Encapsulates multi-warehouse stock tracking, append-only stock ledgers,
// inter-site transfer dispatches/receipts, direct issue-to-asset costing,
// and automated reorder threshold alerting.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import crypto from "crypto";
import type {
  InventoryItem,
  WarehouseLocation,
  StockLevel,
  StockLedgerEntry,
  InterSiteTransfer,
  ReorderAlert,
  IssueStockToAssetDto,
  DispatchTransferDto,
  ReceiveTransferDto,
  AuditAdjustmentDto,
  TransferStatus,
} from "./types";
import { getKafkaBroker } from "@/lib/events/kafka-producer";

@Injectable()
export class InventoryService {
  private items = new Map<string, InventoryItem>();
  private locations = new Map<string, WarehouseLocation>();
  private stockLevels = new Map<string, StockLevel>(); // Key: `${locationId}:${itemCode}`
  private ledgerEntries: StockLedgerEntry[] = [];
  private transfers = new Map<string, InterSiteTransfer>();
  private transferCounter = 1000;

  private makeStockKey(locationId: string, itemCode: string): string {
    return `${locationId}:${itemCode}`;
  }

  registerItem(item: InventoryItem): void {
    this.items.set(item.itemCode, item);
  }

  registerLocation(location: WarehouseLocation): void {
    this.locations.set(location.id, location);
  }

  getItem(itemCode: string): InventoryItem | null {
    return this.items.get(itemCode) || null;
  }

  getLocation(locationId: string): WarehouseLocation | null {
    return this.locations.get(locationId) || null;
  }

  /**
   * Intakes stock into a warehouse (e.g. from Goods Receipt Note).
   */
  async receiveStock(
    locationId: string,
    itemCode: string,
    quantity: number,
    unitCostCents: number,
    referenceId?: string,
    actorId = "system"
  ): Promise<StockLevel> {
    if (quantity <= 0) throw new BadRequestException("Quantity received must be positive");

    const key = this.makeStockKey(locationId, itemCode);
    let level = this.stockLevels.get(key);

    if (!level) {
      level = {
        locationId,
        itemCode,
        quantityOnHand: 0,
        quantityAllocated: 0,
        quantityAvailable: 0,
        updatedAt: new Date(),
      };
      this.stockLevels.set(key, level);
    }

    level.quantityOnHand += quantity;
    level.quantityAvailable = level.quantityOnHand - level.quantityAllocated;
    level.updatedAt = new Date();

    const totalCostCents = Math.round(quantity * unitCostCents);
    this.ledgerEntries.push({
      id: `led_${crypto.randomUUID()}`,
      timestamp: new Date(),
      movementType: "RECEIPT",
      itemCode,
      destinationLocationId: locationId,
      quantity,
      unitCostCents,
      totalCostCents,
      referenceId,
      performedBy: actorId,
    });

    return { ...level };
  }

  /**
   * Directly issues inventory (lubricant, filters, parts) to a vehicle/equipment.
   */
  async issueStockToAsset(
    dto: IssueStockToAssetDto,
    actorId: string
  ): Promise<StockLedgerEntry> {
    if (dto.quantity <= 0) {
      throw new BadRequestException("Issued quantity must be positive");
    }

    const key = this.makeStockKey(dto.locationId, dto.itemCode);
    const level = this.stockLevels.get(key);

    if (!level || level.quantityAvailable < dto.quantity) {
      const avail = level ? level.quantityAvailable : 0;
      throw new BadRequestException(
        `Insufficient stock for item '${dto.itemCode}' at location '${dto.locationId}'. Available: ${avail}, Requested: ${dto.quantity}`
      );
    }

    const item = this.items.get(dto.itemCode);
    const unitCostCents = item ? item.standardCostCents : 0;
    const totalCostCents = Math.round(dto.quantity * unitCostCents);

    level.quantityOnHand -= dto.quantity;
    level.quantityAvailable = level.quantityOnHand - level.quantityAllocated;
    level.updatedAt = new Date();

    const entry: StockLedgerEntry = {
      id: `led_${crypto.randomUUID()}`,
      timestamp: new Date(),
      movementType: "ISSUE_TO_ASSET",
      itemCode: dto.itemCode,
      sourceLocationId: dto.locationId,
      quantity: dto.quantity,
      unitCostCents,
      totalCostCents,
      assetId: dto.assetId,
      workOrderId: dto.workOrderId,
      performedBy: actorId,
      notes: dto.notes,
    };

    this.ledgerEntries.push(entry);

    // Emit StockIssued event to Kafka
    const broker = getKafkaBroker();
    await broker.publish("asset.meter.updated", [
      {
        key: dto.assetId,
        value: JSON.stringify({
          eventType: "StockIssued",
          assetId: dto.assetId,
          itemCode: dto.itemCode,
          quantity: dto.quantity,
          totalCostCents,
          workOrderId: dto.workOrderId,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return entry;
  }

  /**
   * Dispatches an inter-site transfer from Source Location to Destination Location.
   */
  async dispatchTransfer(
    dto: DispatchTransferDto,
    actorId: string
  ): Promise<InterSiteTransfer> {
    if (dto.sourceLocationId === dto.destinationLocationId) {
      throw new BadRequestException("Source and destination locations cannot be identical");
    }
    if (dto.quantity <= 0) {
      throw new BadRequestException("Transfer quantity must be positive");
    }

    const sourceKey = this.makeStockKey(dto.sourceLocationId, dto.itemCode);
    const sourceLevel = this.stockLevels.get(sourceKey);

    if (!sourceLevel || sourceLevel.quantityAvailable < dto.quantity) {
      const avail = sourceLevel ? sourceLevel.quantityAvailable : 0;
      throw new BadRequestException(
        `Insufficient stock at source location '${dto.sourceLocationId}'. Available: ${avail}, Requested: ${dto.quantity}`
      );
    }

    // Deduct from source warehouse
    sourceLevel.quantityOnHand -= dto.quantity;
    sourceLevel.quantityAvailable = sourceLevel.quantityOnHand - sourceLevel.quantityAllocated;
    sourceLevel.updatedAt = new Date();

    this.transferCounter++;
    const transferId = `trf_${crypto.randomUUID()}`;
    const transferNumber = `TRF-${new Date().getFullYear()}-${this.transferCounter}`;

    const transfer: InterSiteTransfer = {
      id: transferId,
      transferNumber,
      sourceLocationId: dto.sourceLocationId,
      destinationLocationId: dto.destinationLocationId,
      itemCode: dto.itemCode,
      quantityDispatched: dto.quantity,
      status: "IN_TRANSIT",
      dispatchedAt: new Date(),
      dispatchedBy: actorId,
      notes: dto.notes,
    };

    this.transfers.set(transferId, transfer);

    const item = this.items.get(dto.itemCode);
    const unitCost = item ? item.standardCostCents : 0;

    this.ledgerEntries.push({
      id: `led_${crypto.randomUUID()}`,
      timestamp: new Date(),
      movementType: "TRANSFER_DISPATCH",
      itemCode: dto.itemCode,
      sourceLocationId: dto.sourceLocationId,
      destinationLocationId: dto.destinationLocationId,
      quantity: dto.quantity,
      unitCostCents: unitCost,
      totalCostCents: Math.round(dto.quantity * unitCost),
      referenceId: transferId,
      performedBy: actorId,
    });

    return transfer;
  }

  /**
   * Acknowledges receipt of an inter-site transfer at destination location.
   */
  async receiveTransfer(
    dto: ReceiveTransferDto,
    actorId: string
  ): Promise<InterSiteTransfer> {
    const transfer = this.transfers.get(dto.transferId);
    if (!transfer) {
      throw new NotFoundException(`Transfer ${dto.transferId} not found`);
    }

    if (transfer.status !== "IN_TRANSIT") {
      throw new BadRequestException(
        `Cannot receive transfer in status '${transfer.status}'. Expected IN_TRANSIT.`
      );
    }

    const qtyReceived = dto.quantityReceived !== undefined ? dto.quantityReceived : transfer.quantityDispatched;
    if (qtyReceived < 0) {
      throw new BadRequestException("Received quantity cannot be negative");
    }

    // Add to destination warehouse
    const destKey = this.makeStockKey(transfer.destinationLocationId, transfer.itemCode);
    let destLevel = this.stockLevels.get(destKey);
    if (!destLevel) {
      destLevel = {
        locationId: transfer.destinationLocationId,
        itemCode: transfer.itemCode,
        quantityOnHand: 0,
        quantityAllocated: 0,
        quantityAvailable: 0,
        updatedAt: new Date(),
      };
      this.stockLevels.set(destKey, destLevel);
    }

    destLevel.quantityOnHand += qtyReceived;
    destLevel.quantityAvailable = destLevel.quantityOnHand - destLevel.quantityAllocated;
    destLevel.updatedAt = new Date();

    transfer.status = "RECEIVED";
    transfer.quantityReceived = qtyReceived;
    transfer.receivedAt = new Date();
    transfer.receivedBy = actorId;

    const item = this.items.get(transfer.itemCode);
    const unitCost = item ? item.standardCostCents : 0;

    this.ledgerEntries.push({
      id: `led_${crypto.randomUUID()}`,
      timestamp: new Date(),
      movementType: "TRANSFER_RECEIPT",
      itemCode: transfer.itemCode,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      quantity: qtyReceived,
      unitCostCents: unitCost,
      totalCostCents: Math.round(qtyReceived * unitCost),
      referenceId: transfer.id,
      performedBy: actorId,
      notes: dto.notes,
    });

    return transfer;
  }

  /**
   * Adjusts stock level based on physical inventory count audit. Requires ADMIN or MANAGER.
   */
  async auditAdjustStock(
    dto: AuditAdjustmentDto,
    actorId: string,
    actorRole: string
  ): Promise<StockLevel> {
    const authorizedRoles = ["ADMIN", "MANAGER", "SUPER_ADMIN"];
    if (!authorizedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `User with role '${actorRole}' is not authorized to post stock audit adjustments`
      );
    }

    if (dto.physicalCount < 0) {
      throw new BadRequestException("Physical count cannot be negative");
    }

    const key = this.makeStockKey(dto.locationId, dto.itemCode);
    let level = this.stockLevels.get(key);
    if (!level) {
      level = {
        locationId: dto.locationId,
        itemCode: dto.itemCode,
        quantityOnHand: 0,
        quantityAllocated: 0,
        quantityAvailable: 0,
        updatedAt: new Date(),
      };
      this.stockLevels.set(key, level);
    }

    const varianceQty = dto.physicalCount - level.quantityOnHand;
    level.quantityOnHand = dto.physicalCount;
    level.quantityAvailable = level.quantityOnHand - level.quantityAllocated;
    level.updatedAt = new Date();

    const item = this.items.get(dto.itemCode);
    const unitCost = item ? item.standardCostCents : 0;

    this.ledgerEntries.push({
      id: `led_${crypto.randomUUID()}`,
      timestamp: new Date(),
      movementType: "AUDIT_ADJUSTMENT",
      itemCode: dto.itemCode,
      sourceLocationId: dto.locationId,
      quantity: varianceQty,
      unitCostCents: unitCost,
      totalCostCents: Math.round(varianceQty * unitCost),
      performedBy: actorId,
      notes: `Physical audit: ${dto.reason} (Variance: ${varianceQty})`,
    });

    return { ...level };
  }

  /**
   * Evaluates all stock levels against reorder thresholds to identify items needing replenishment.
   */
  async checkReorderAlerts(locationId?: string): Promise<ReorderAlert[]> {
    const alerts: ReorderAlert[] = [];

    for (const level of this.stockLevels.values()) {
      if (locationId && level.locationId !== locationId) continue;

      const item = this.items.get(level.itemCode);
      if (!item) continue;

      if (level.quantityAvailable <= item.reorderThreshold) {
        alerts.push({
          locationId: level.locationId,
          itemCode: level.itemCode,
          itemName: item.name,
          currentAvailable: level.quantityAvailable,
          reorderThreshold: item.reorderThreshold,
          suggestedReorderQuantity: item.reorderQuantity,
          estimatedCostCents: Math.round(item.reorderQuantity * item.standardCostCents),
        });
      }
    }

    return alerts;
  }

  async getStockLevel(locationId: string, itemCode: string): Promise<StockLevel | null> {
    const key = this.makeStockKey(locationId, itemCode);
    const level = this.stockLevels.get(key);
    return level ? { ...level } : null;
  }

  async getStockLevels(locationId?: string): Promise<StockLevel[]> {
    const list = Array.from(this.stockLevels.values());
    if (locationId) {
      return list.filter((l) => l.locationId === locationId);
    }
    return list.map((l) => ({ ...l }));
  }

  async getLedgerEntries(filter?: {
    itemCode?: string;
    locationId?: string;
    assetId?: string;
  }): Promise<StockLedgerEntry[]> {
    let list = [...this.ledgerEntries];
    if (filter?.itemCode) {
      list = list.filter((e) => e.itemCode === filter.itemCode);
    }
    if (filter?.locationId) {
      list = list.filter(
        (e) => e.sourceLocationId === filter.locationId || e.destinationLocationId === filter.locationId
      );
    }
    if (filter?.assetId) {
      list = list.filter((e) => e.assetId === filter.assetId);
    }
    return list;
  }

  async getTransfers(status?: TransferStatus): Promise<InterSiteTransfer[]> {
    const list = Array.from(this.transfers.values());
    if (status) {
      return list.filter((t) => t.status === status);
    }
    return list;
  }

  clear(): void {
    this.items.clear();
    this.locations.clear();
    this.stockLevels.clear();
    this.ledgerEntries = [];
    this.transfers.clear();
  }
}
