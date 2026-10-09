// ============================================================================
// Phase 19 / Wave F: Equipment Maintenance & Work Order Domain Application Service
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
//
// Encapsulates Work Order lifecycle management, Three-Pillar Cost Rollups
// (Labor, Parts, Sublet), Preventative Maintenance (PM) meter triggers,
// and equipment maintenance cost aggregation.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import crypto from "crypto";
import type {
  WorkOrder,
  WorkOrderStatus,
  LaborEntry,
  PartsConsumedEntry,
  SubletEntry,
  PMIntervalRule,
  PMDueEvaluation,
  CreateWorkOrderDto,
  AddLaborDto,
  AddPartConsumedDto,
  AddSubletDto,
  CompleteWorkOrderDto,
  CloseWorkOrderDto,
} from "./types";
import { getKafkaBroker } from "@/lib/events/kafka-producer";

const DEFAULT_LABOR_RATE_CENTS = 150000; // 1,500.00 LKR / hr

@Injectable()
export class MaintenanceService {
  private workOrders = new Map<string, WorkOrder>();
  private pmRules: PMIntervalRule[] = [];
  private woCounter = 1000;

  registerPMRule(rule: PMIntervalRule): void {
    this.pmRules.push(rule);
  }

  /**
   * Creates a new Work Order in OPEN status.
   */
  async createWorkOrder(
    dto: CreateWorkOrderDto,
    actorId: string
  ): Promise<WorkOrder> {
    if (dto.meterAtCreation < 0) {
      throw new BadRequestException("Meter at creation cannot be negative");
    }

    this.woCounter++;
    const id = `wo_${crypto.randomUUID()}`;
    const workOrderNumber = `WO-${new Date().getFullYear()}-${this.woCounter}`;

    const workOrder: WorkOrder = {
      id,
      workOrderNumber,
      assetId: dto.assetId,
      assetCode: dto.assetCode,
      siteId: dto.siteId,
      type: dto.type,
      priority: dto.priority || "NORMAL",
      status: "OPEN",
      description: dto.description,
      meterAtCreation: dto.meterAtCreation,
      assignedTechnician: dto.assignedTechnician,
      laborEntries: [],
      partsConsumed: [],
      subletEntries: [],
      totalLaborCostCents: 0,
      totalPartsCostCents: 0,
      totalSubletCostCents: 0,
      totalCostCents: 0,
      openedAt: new Date(),
      openedBy: actorId,
      notes: dto.notes,
    };

    this.workOrders.set(id, workOrder);

    // Emit WorkOrderCreated event to Kafka broker
    const broker = getKafkaBroker();
    await broker.publish("asset.meter.updated", [
      {
        key: workOrder.assetId,
        value: JSON.stringify({
          eventType: "WorkOrderCreated",
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.workOrderNumber,
          assetId: workOrder.assetId,
          type: workOrder.type,
          priority: workOrder.priority,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return workOrder;
  }

  /**
   * Logs technician labor hours on a work order.
   */
  async addLabor(workOrderId: string, dto: AddLaborDto): Promise<WorkOrder> {
    const wo = this.workOrders.get(workOrderId);
    if (!wo) throw new NotFoundException(`Work Order ${workOrderId} not found`);

    if (wo.status === "CLOSED") {
      throw new BadRequestException("Cannot log labor on a CLOSED work order");
    }
    if (dto.hours <= 0) {
      throw new BadRequestException("Labor hours must be positive");
    }

    const hourlyRate = dto.hourlyRateCents ?? DEFAULT_LABOR_RATE_CENTS;
    const totalCostCents = Math.round(dto.hours * hourlyRate);

    const laborEntry: LaborEntry = {
      id: `lab_${crypto.randomUUID()}`,
      technicianId: dto.technicianId,
      technicianName: dto.technicianName,
      hours: dto.hours,
      hourlyRateCents: hourlyRate,
      totalCostCents,
      date: new Date(),
      notes: dto.notes,
    };

    wo.laborEntries.push(laborEntry);
    wo.totalLaborCostCents += totalCostCents;
    wo.totalCostCents = wo.totalLaborCostCents + wo.totalPartsCostCents + wo.totalSubletCostCents;

    if (wo.status === "OPEN") {
      wo.status = "IN_PROGRESS";
    }

    return wo;
  }

  /**
   * Logs parts/lubricants consumed on a work order.
   */
  async addPartConsumed(
    workOrderId: string,
    dto: AddPartConsumedDto
  ): Promise<WorkOrder> {
    const wo = this.workOrders.get(workOrderId);
    if (!wo) throw new NotFoundException(`Work Order ${workOrderId} not found`);

    if (wo.status === "CLOSED") {
      throw new BadRequestException("Cannot add parts to a CLOSED work order");
    }
    if (dto.quantity <= 0) {
      throw new BadRequestException("Quantity must be positive");
    }
    if (dto.unitCostCents < 0) {
      throw new BadRequestException("Unit cost cannot be negative");
    }

    const totalCostCents = Math.round(dto.quantity * dto.unitCostCents);

    const partsEntry: PartsConsumedEntry = {
      id: `prt_${crypto.randomUUID()}`,
      itemCode: dto.itemCode,
      description: dto.description,
      quantity: dto.quantity,
      unitCostCents: dto.unitCostCents,
      totalCostCents,
      inventoryLedgerId: dto.inventoryLedgerId,
    };

    wo.partsConsumed.push(partsEntry);
    wo.totalPartsCostCents += totalCostCents;
    wo.totalCostCents = wo.totalLaborCostCents + wo.totalPartsCostCents + wo.totalSubletCostCents;

    return wo;
  }

  /**
   * Logs outsourced/sublet vendor costs on a work order.
   */
  async addSublet(workOrderId: string, dto: AddSubletDto): Promise<WorkOrder> {
    const wo = this.workOrders.get(workOrderId);
    if (!wo) throw new NotFoundException(`Work Order ${workOrderId} not found`);

    if (wo.status === "CLOSED") {
      throw new BadRequestException("Cannot add sublet costs to a CLOSED work order");
    }
    if (dto.costCents <= 0) {
      throw new BadRequestException("Sublet cost must be positive");
    }

    const subletEntry: SubletEntry = {
      id: `sub_${crypto.randomUUID()}`,
      vendorName: dto.vendorName,
      serviceDescription: dto.serviceDescription,
      invoiceNumber: dto.invoiceNumber,
      costCents: dto.costCents,
    };

    wo.subletEntries.push(subletEntry);
    wo.totalSubletCostCents += dto.costCents;
    wo.totalCostCents = wo.totalLaborCostCents + wo.totalPartsCostCents + wo.totalSubletCostCents;

    return wo;
  }

  /**
   * Marks a work order as COMPLETED.
   */
  async completeWorkOrder(
    workOrderId: string,
    dto: CompleteWorkOrderDto,
    actorId: string
  ): Promise<WorkOrder> {
    const wo = this.workOrders.get(workOrderId);
    if (!wo) throw new NotFoundException(`Work Order ${workOrderId} not found`);

    if (wo.status === "CLOSED" || wo.status === "COMPLETED") {
      throw new BadRequestException(`Cannot complete work order in status '${wo.status}'`);
    }

    if (dto.meterAtCompletion !== undefined && dto.meterAtCompletion < wo.meterAtCreation) {
      throw new BadRequestException(
        `Completion meter (${dto.meterAtCompletion}) cannot be less than creation meter (${wo.meterAtCreation})`
      );
    }

    wo.status = "COMPLETED";
    wo.completedAt = new Date();
    wo.meterAtCompletion = dto.meterAtCompletion;
    if (dto.notes) wo.notes = `${wo.notes ? wo.notes + " | " : ""}${dto.notes}`;

    // Emit WorkOrderCompleted event to Kafka broker
    const broker = getKafkaBroker();
    await broker.publish("asset.meter.updated", [
      {
        key: wo.assetId,
        value: JSON.stringify({
          eventType: "WorkOrderCompleted",
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber,
          assetId: wo.assetId,
          totalCostCents: wo.totalCostCents,
          completedBy: actorId,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);

    return wo;
  }

  /**
   * Finalizes and closes a work order. Requires ADMIN or MANAGER role.
   */
  async closeWorkOrder(
    workOrderId: string,
    actorId: string,
    actorRole: string,
    dto?: CloseWorkOrderDto
  ): Promise<WorkOrder> {
    const wo = this.workOrders.get(workOrderId);
    if (!wo) throw new NotFoundException(`Work Order ${workOrderId} not found`);

    const authorizedRoles = ["ADMIN", "MANAGER", "SUPER_ADMIN", "SUPERVISOR"];
    if (!authorizedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `User with role '${actorRole}' is not authorized to sign off and close work orders`
      );
    }

    if (wo.status !== "COMPLETED") {
      throw new BadRequestException(
        `Cannot close work order in status '${wo.status}'. Work order must be COMPLETED before supervisor sign-off.`
      );
    }

    wo.status = "CLOSED";
    wo.closedAt = new Date();
    wo.closedBy = actorId;
    if (dto?.supervisorNotes) {
      wo.notes = `${wo.notes ? wo.notes + " | " : ""}Signoff: ${dto.supervisorNotes}`;
    }

    return wo;
  }

  /**
   * Evaluates Preventative Maintenance meter rules against asset current meters.
   */
  evaluatePMTriggers(
    assetId: string,
    assetCode: string,
    currentMeter: number,
    lastServiceMeter: number
  ): PMDueEvaluation[] {
    const evaluations: PMDueEvaluation[] = [];

    for (const rule of this.pmRules) {
      const nextDueMeter = lastServiceMeter + rule.intervalHours;
      const hoursRemaining = nextDueMeter - currentMeter;
      const isOverdue = currentMeter >= nextDueMeter;

      evaluations.push({
        assetId,
        assetCode,
        currentMeter,
        lastServiceMeter,
        nextDueMeter,
        hoursRemaining,
        isOverdue,
        pmRuleName: rule.serviceName,
      });
    }

    return evaluations;
  }

  /**
   * Aggregates total maintenance costs across all work orders for a specific equipment.
   */
  async getAssetTotalMaintenanceCost(assetId: string): Promise<{
    assetId: string;
    totalLaborCostCents: number;
    totalPartsCostCents: number;
    totalSubletCostCents: number;
    totalCostCents: number;
    workOrdersCount: number;
  }> {
    const assetWos = Array.from(this.workOrders.values()).filter(
      (wo) => wo.assetId === assetId
    );

    let totalLaborCostCents = 0;
    let totalPartsCostCents = 0;
    let totalSubletCostCents = 0;

    for (const wo of assetWos) {
      totalLaborCostCents += wo.totalLaborCostCents;
      totalPartsCostCents += wo.totalPartsCostCents;
      totalSubletCostCents += wo.totalSubletCostCents;
    }

    return {
      assetId,
      totalLaborCostCents,
      totalPartsCostCents,
      totalSubletCostCents,
      totalCostCents: totalLaborCostCents + totalPartsCostCents + totalSubletCostCents,
      workOrdersCount: assetWos.length,
    };
  }

  async getWorkOrders(filter?: {
    status?: WorkOrderStatus;
    assetId?: string;
    siteId?: string;
  }): Promise<WorkOrder[]> {
    let list = Array.from(this.workOrders.values());
    if (filter?.status) list = list.filter((w) => w.status === filter.status);
    if (filter?.assetId) list = list.filter((w) => w.assetId === filter.assetId);
    if (filter?.siteId) list = list.filter((w) => w.siteId === filter.siteId);
    return list;
  }

  async getWorkOrder(id: string): Promise<WorkOrder | null> {
    return this.workOrders.get(id) || null;
  }

  clear(): void {
    this.workOrders.clear();
    this.pmRules = [];
  }
}
