// ============================================================================
// NestJS Billing Module: Domain Application Service
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@/lib/db";
import { bulkFinalizeBillsAction, bulkMarkPaidAction, bulkSetBillBasisAction } from "@/app/actions/billing";
import { normalizePaginationParams, buildPaginationMeta } from "@/lib/pagination/paginate";

@Injectable()
export class BillingService {
  /**
   * Retrieves paginated invoices for a periodKey.
   */
  async getInvoicesPaginated(options: {
    periodKey: string;
    projectId?: string | null;
    status?: string | null;
    page?: number | string;
    limit?: number | string;
  }) {
    const { page, limit, skip } = normalizePaginationParams({
      page: options.page,
      limit: options.limit,
    });

    const where: any = { periodKey: options.periodKey };
    if (options.projectId) where.projectId = options.projectId;
    if (options.status && options.status !== "all") where.status = options.status;

    const [totalCount, bills] = await prisma.$transaction([
      prisma.bill.count({ where }),
      prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { grandTotalCents: "desc" },
      }),
    ]);

    return {
      data: bills,
      pagination: buildPaginationMeta(totalCount, page, limit),
    };
  }

  /**
   * Finalizes draft bills into sequential invoices.
   */
  async bulkFinalizeBills(billIds: string[]) {
    const result = await bulkFinalizeBillsAction(billIds);
    if (result.error) throw new BadRequestException(result.error);
    return result;
  }

  /**
   * Marks issued bills as paid.
   */
  async bulkMarkPaid(billIds: string[]) {
    const result = await bulkMarkPaidAction(billIds);
    if (result.error) throw new BadRequestException(result.error);
    return result;
  }

  /**
   * Updates billing basis (Dry / Wet / Fully Wet).
   */
  async bulkSetBasis(billIds: string[], basis: string) {
    const result = await bulkSetBillBasisAction(billIds, basis);
    if (result.error) throw new BadRequestException(result.error);
    return result;
  }
}
