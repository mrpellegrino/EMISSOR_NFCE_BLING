import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CaptureWebsiteLeadDto,
  CreateLeadDto,
  UpdateLeadDto,
} from './dto/crm-lead.dto';
import { CaptureWebsiteLeadUseCase } from './usecases/capture-website-lead.usecase';
import { CreateLeadUseCase } from './usecases/create-lead.usecase';
import { ListLeadsUseCase } from './usecases/list-leads.usecase';
import { UpdateLeadUseCase } from './usecases/update-lead.usecase';
import { DeleteLeadUseCase } from './usecases/delete-lead.usecase';
import { GetCrmFunnelMetricsUseCase } from './usecases/get-crm-funnel-metrics.usecase';

@Controller('crm')
export class CrmController {
  constructor(
    private readonly captureWebsiteLeadUseCase: CaptureWebsiteLeadUseCase,
    private readonly createLeadUseCase: CreateLeadUseCase,
    private readonly listLeadsUseCase: ListLeadsUseCase,
    private readonly updateLeadUseCase: UpdateLeadUseCase,
    private readonly deleteLeadUseCase: DeleteLeadUseCase,
    private readonly getCrmFunnelMetricsUseCase: GetCrmFunnelMetricsUseCase,
  ) {}

  // Public endpoints to receive leads directly from the Vila Pet website forms
  @Post('webhook/leads')
  async captureWebsiteLead(
    @Body() dto: CaptureWebsiteLeadDto,
    @Req() req: ExpressRequest,
    @Headers('x-webhook-key') headerKey?: string,
    @Query('key') queryKey?: string,
  ) {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const lead = await this.captureWebsiteLeadUseCase.execute(dto, undefined, {
      clientIp,
      webhookKey: headerKey || queryKey,
      isPublicWebhook: true,
    });
    if (lead.id === 'ignored') {
      return { ok: true, ignored: true };
    }
    return { ok: true, id: lead.id, lead };
  }

  @Post('public/leads')
  async capturePublicLead(
    @Body() dto: CaptureWebsiteLeadDto,
    @Req() req: ExpressRequest,
    @Headers('x-webhook-key') headerKey?: string,
    @Query('key') queryKey?: string,
  ) {
    return this.captureWebsiteLead(dto, req, headerKey, queryKey);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leads')
  async listLeads(
    @Query('stage') stage?: string,
    @Query('source') source?: string,
    @Query('utmCampaign') utmCampaign?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.listLeadsUseCase.execute({
      stage,
      source,
      utmCampaign,
      search,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads')
  async createLead(
    @Body() dto: CreateLeadDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.createLeadUseCase.execute(dto, req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('leads/:id')
  async updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.updateLeadUseCase.execute(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('leads/:id')
  async deleteLead(@Param('id') id: string) {
    return this.deleteLeadUseCase.execute(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('metrics')
  async getMetrics() {
    return this.getCrmFunnelMetricsUseCase.execute();
  }
}
