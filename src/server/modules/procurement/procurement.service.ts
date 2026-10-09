// ============================================================================
// Phase 19 / Wave F: Procurement & Supplier Receipt Domain Application Service
// Reference: Fuel-System-V3 Plan Section 24 (Phase 19) & Wave F (ERP Expansion)
//
// Encapsulates Purchase Order lifecycle, Goods Receipt Notes (GRN),
// Bowsers/Tank refilling tickets, and Three-Way Reconciliation Matching.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import crypto from "crypto";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  GoodsReceiptNote,
  GoodsReceiptLine,
  ThreeWayMatchResult,
  CreatePurchaseOrderDto,
  CreateGoodsReceiptDto,
  PurchaseOrderStatus,
} from "./types";
import { getKafkaBroker } from "@/lib/events/kafka-producer";
import { resolveKafkaTopic } from "@/lib/events/topic-router";

@Injectable()
export class ProcurementService {
  private purchaseOrders = new Map<string, PurchaseOrder>();
  private goodsReceipts = new Map<string, GoodsReceiptNote>();
  private poCounter = 1000;
  private grnCounter = 5000;

  /**
   * Creates a new Purchase Order in DRAFT status with calculated totals.
   */
  async createPurchaseOrder(
    dto: CreatePurchaseOrderDto,
    actorId: string
  ): Promise<PurchaseOrder> {
    if (!dto.lineItems || dto.lineItems.length === 0) {
      throw new BadRequestException("Purchase order must contain at least one line item");
    }

    this.poCounter++;
    const poId = `po_${crypto.randomUUID()}`;
    const poNumber = `PO-${new Date().getFullYear()}-${this.poCounter}`;

    let totalAmountCents = 0;
    const lineItems: PurchaseOrderLine[] = dto.lineItems.map((item, idx) => {
      if (item.orderedQuantity <= 0) {
        throw new BadRequestException(`Line item ${idx + 1}: quantity must be positive`);
      }
      if (item.unitPriceCents < 0) {
        throw new BadRequestException(`Line item ${idx + 1}: unit price cannot be negative`);
      }

      const totalCostCents = Math.round(item.orderedQuantity * item.unitPriceCents);
      totalAmountCents += totalCostCents;

      return {
        id: `line_${crypto.randomUUID()}`,
        itemCategory: item.itemCategory,
        itemCode: item.itemCode,
        description: item.description,
        orderedQuantity: item.orderedQuantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        totalCostCents,
        receivedQuantity: 0,
      };
    });

    const po: PurchaseOrder = {
      id: poId,
      poNumber,
      supplierId: dto.supplierId,
      supplierName: dto.supplierName,
      siteId: dto.siteId,
      status: "DRAFT",
      orderedAt: new Date(),
      currency: dto.currency || "LKR",
      totalAmountCents,
      lineItems,
      notes: dto.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.purchaseOrders.set(poId, po);
    return po;
  }

  /**
   * Approves a Purchase Order. Requires ADMIN or MANAGER role.
   */
  async approvePurchaseOrder(
    poId: string,
    actorId: string,
    actorRole: string
  ): Promise<PurchaseOrder> {
    const po = this.purchaseOrders.get(poId);
    if (!po) {
      throw new NotFoundException(`Purchase Order ${poId} not found`);
    }

    const authorizedRoles = ["ADMIN", "MANAGER", "SUPER_ADMIN"];
    if (!authorizedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `User with role '${actorRole}' is not authorized to approve purchase orders. Requires ADMIN or MANAGER.`
      );
    }

    if (po.status !== "DRAFT" && po.status !== "SUBMITTED") {
      throw new BadRequestException(
        `Cannot approve Purchase Order in status '${po.status}'. Expected DRAFT or SUBMITTED.`
      );
    }

    po.status = "APPROVED";
    po.approvedAt = new Date();
    po.approvedBy = actorId;
    po.updatedAt = new Date();

    // Emit ProcurementOrderApproved to Kafka Broker
    const broker = getKafkaBroker();
    const topic = resolveKafkaTopic("FuelRequestApproved") || "events.procurement";
    await broker.publish(topic, [
      {
        key: po.siteId,
        value: JSON.stringify({
          eventType: "ProcurementOrderApproved",
          poId: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          totalAmountCents: po.totalAmountCents,
          approvedBy: actorId,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return po;
  }

  /**
   * Records physical goods receipt (GRN) against an approved Purchase Order.
   */
  async recordGoodsReceipt(
    dto: CreateGoodsReceiptDto,
    actorId: string
  ): Promise<GoodsReceiptNote> {
    const po = this.purchaseOrders.get(dto.purchaseOrderId);
    if (!po) {
      throw new NotFoundException(`Purchase Order ${dto.purchaseOrderId} not found`);
    }

    if (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") {
      throw new BadRequestException(
        `Cannot receive goods for Purchase Order in status '${po.status}'. PO must be APPROVED.`
      );
    }

    if (!dto.batchTicketNumber || dto.batchTicketNumber.trim() === "") {
      throw new BadRequestException("Goods Receipt Note requires a valid supplier batch ticket number");
    }

    this.grnCounter++;
    const grnId = `grn_${crypto.randomUUID()}`;
    const grnNumber = `GRN-${new Date().getFullYear()}-${this.grnCounter}`;

    let totalAcceptedQuantity = 0;
    const receiptItems: GoodsReceiptLine[] = [];

    for (const item of dto.items) {
      const poLine = po.lineItems.find((l) => l.id === item.poLineId);
      if (!poLine) {
        throw new BadRequestException(`Referenced PO line item '${item.poLineId}' not found on PO`);
      }

      if (item.deliveredQuantity <= 0) {
        throw new BadRequestException("Delivered quantity must be greater than zero");
      }

      // Fuel temperature/density thermal normalization if temperature specified
      let netDelivered = item.deliveredQuantity;
      if (item.temperatureC !== undefined && item.temperatureC !== 15 && poLine.itemCategory === "FUEL") {
        // Standard petroleum expansion coefficient beta = 0.00095 per deg C
        const thermalFactor = 1 - 0.00095 * (item.temperatureC - 15);
        netDelivered = Number((item.deliveredQuantity * thermalFactor).toFixed(2));
      }

      const rejectedQty = item.rejectedQuantity || 0;
      const acceptedQty = Math.max(0, netDelivered - rejectedQty);
      totalAcceptedQuantity += acceptedQty;

      // Update PO line received progress
      poLine.receivedQuantity += acceptedQty;

      receiptItems.push({
        id: `grn_line_${crypto.randomUUID()}`,
        poLineId: item.poLineId,
        itemCode: item.itemCode,
        deliveredQuantity: item.deliveredQuantity,
        unit: item.unit,
        temperatureC: item.temperatureC,
        density: item.density,
        acceptedQuantity: acceptedQty,
        rejectedQuantity: rejectedQty,
        rejectionReason: item.rejectionReason,
      });
    }

    // Determine updated PO status
    const allLinesCompleted = po.lineItems.every(
      (l) => l.receivedQuantity >= l.orderedQuantity
    );
    po.status = allLinesCompleted ? "RECEIVED" : "PARTIALLY_RECEIVED";
    po.updatedAt = new Date();

    const grn: GoodsReceiptNote = {
      id: grnId,
      grnNumber,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      siteId: dto.siteId,
      tankId: dto.tankId,
      batchTicketNumber: dto.batchTicketNumber,
      receivedAt: new Date(),
      receivedBy: actorId,
      items: receiptItems,
      totalAcceptedQuantity,
      notes: dto.notes,
      createdAt: new Date(),
    };

    this.goodsReceipts.set(grnId, grn);

    // Emit GoodsReceived event
    const broker = getKafkaBroker();
    await broker.publish("fuel.issue.created", [
      {
        key: grn.siteId,
        value: JSON.stringify({
          eventType: "GoodsReceived",
          grnId: grn.id,
          grnNumber: grn.grnNumber,
          poId: po.id,
          batchTicket: grn.batchTicketNumber,
          totalAcceptedQuantity,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return grn;
  }

  /**
   * Performs three-way reconciliation between Purchase Order, Goods Receipt, and Invoice amounts.
   */
  async performThreeWayMatch(
    poId: string,
    grnId: string,
    toleranceAllowedPercentage = 0.5 // 0.5% default for petroleum expansion
  ): Promise<ThreeWayMatchResult> {
    const po = this.purchaseOrders.get(poId);
    if (!po) throw new NotFoundException(`Purchase Order ${poId} not found`);

    const grn = this.goodsReceipts.get(grnId);
    if (!grn) throw new NotFoundException(`Goods Receipt ${grnId} not found`);

    let receivedCalculatedCents = 0;
    const discrepancies: ThreeWayMatchResult["discrepancies"] = [];

    for (const rItem of grn.items) {
      const poLine = po.lineItems.find((l) => l.id === rItem.poLineId);
      if (!poLine) continue;

      const lineReceivedCost = Math.round(rItem.acceptedQuantity * poLine.unitPriceCents);
      receivedCalculatedCents += lineReceivedCost;

      const lineVarianceQty = rItem.acceptedQuantity - poLine.orderedQuantity;
      const lineVariancePct = (Math.abs(lineVarianceQty) / poLine.orderedQuantity) * 100;

      if (lineVariancePct > toleranceAllowedPercentage) {
        discrepancies.push({
          poLineId: poLine.id,
          itemCode: poLine.itemCode,
          orderedQty: poLine.orderedQuantity,
          receivedQty: rItem.acceptedQuantity,
          varianceQty: lineVarianceQty,
          reason: `Quantity variance ${lineVariancePct.toFixed(2)}% exceeds allowed tolerance ${toleranceAllowedPercentage}%`,
        });
      }
    }

    const varianceCents = receivedCalculatedCents - po.totalAmountCents;
    const variancePercentage = (Math.abs(varianceCents) / po.totalAmountCents) * 100;

    let matchStatus: ThreeWayMatchResult["matchStatus"] = "PERFECT_MATCH";
    if (discrepancies.length > 0 || variancePercentage > toleranceAllowedPercentage) {
      matchStatus = "DISCREPANCY";
    } else if (variancePercentage > 0) {
      matchStatus = "TOLERANCE_ACCEPTED";
    }

    return {
      purchaseOrderId: po.id,
      grnId: grn.id,
      matchStatus,
      orderedTotalCents: po.totalAmountCents,
      receivedCalculatedCents,
      varianceCents,
      variancePercentage: Number(variancePercentage.toFixed(2)),
      toleranceAllowedPercentage,
      discrepancies,
    };
  }

  async getPurchaseOrders(filter?: { status?: PurchaseOrderStatus; siteId?: string }): Promise<PurchaseOrder[]> {
    let list = Array.from(this.purchaseOrders.values());
    if (filter?.status) {
      list = list.filter((p) => p.status === filter.status);
    }
    if (filter?.siteId) {
      list = list.filter((p) => p.siteId === filter.siteId);
    }
    return list;
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    return this.purchaseOrders.get(id) || null;
  }

  async getGoodsReceipts(poId?: string): Promise<GoodsReceiptNote[]> {
    const list = Array.from(this.goodsReceipts.values());
    if (poId) {
      return list.filter((g) => g.purchaseOrderId === poId);
    }
    return list;
  }

  clear(): void {
    this.purchaseOrders.clear();
    this.goodsReceipts.clear();
  }
}
