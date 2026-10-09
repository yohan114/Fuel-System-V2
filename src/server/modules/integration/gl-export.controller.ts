// ============================================================================
// Phase 19 / Wave F: General Ledger (GL) Export Controller
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { GLExportService } from "./gl-export.service";
import type { GenerateJournalBatchDto } from "./types";

@Controller("api/v3/integration/gl")
export class GLExportController {
  constructor(private readonly glExportService: GLExportService) {}

  @Post("batches")
  async generateJournalBatch(
    @Body() dto: GenerateJournalBatchDto,
    @Req() req: any
  ) {
    const actorId = req.user?.id || req.user?.email || "chief-accountant";
    return this.glExportService.generateJournalBatch(dto, actorId);
  }

  @Get("batches/:id/csv")
  async exportBatchToCSV(
    @Param("id") id: string,
    @Res() res: any
  ) {
    const result = await this.glExportService.exportBatchToCSV(id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.batchNumber}.csv"`
    );
    return res.status(200).send(result.csvContent);
  }

  @Get("batches/:id/json")
  async exportBatchToJSON(@Param("id") id: string) {
    return this.glExportService.exportBatchToJSON(id);
  }

  @Get("batches")
  async getJournalBatches(@Query("period") period?: string) {
    return this.glExportService.getJournalBatches(period);
  }

  @Get("batches/:id")
  async getJournalBatch(@Param("id") id: string) {
    return this.glExportService.getJournalBatch(id);
  }
}
