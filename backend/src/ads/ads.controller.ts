import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpsertAdCampaignMetricDto } from './dto/ad-campaign-metric.dto';
import { UpsertAdCampaignMetricUseCase } from './usecases/upsert-ad-campaign-metric.usecase';
import { ListAdCampaignMetricsUseCase } from './usecases/list-ad-campaign-metrics.usecase';
import { DeleteAdCampaignMetricUseCase } from './usecases/delete-ad-campaign-metric.usecase';
import { GetPaidTrafficPerformanceUseCase } from './usecases/get-paid-traffic-performance.usecase';

@Controller('ads')
@UseGuards(JwtAuthGuard)
export class AdsController {
  constructor(
    private readonly upsertMetricUseCase: UpsertAdCampaignMetricUseCase,
    private readonly listMetricsUseCase: ListAdCampaignMetricsUseCase,
    private readonly deleteMetricUseCase: DeleteAdCampaignMetricUseCase,
    private readonly getPerformanceUseCase: GetPaidTrafficPerformanceUseCase,
  ) {}

  @Get('metrics')
  async listMetrics(
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.listMetricsUseCase.execute({
      platform,
      status,
      startDate,
      endDate,
    });
  }

  @Post('metrics')
  async upsertMetric(
    @Body() dto: UpsertAdCampaignMetricDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.upsertMetricUseCase.execute(dto, req.user?.id);
  }

  @Delete('metrics/:id')
  async deleteMetric(@Param('id') id: string) {
    return this.deleteMetricUseCase.execute(id);
  }

  @Get('performance')
  async getPerformance() {
    return this.getPerformanceUseCase.execute();
  }
}
