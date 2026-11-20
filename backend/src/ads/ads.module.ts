import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdCampaignMetric } from './entities/ad-campaign-metric.entity';
import { CrmLead } from '../crm/entities/crm-lead.entity';
import { PedidoVendaRPS } from '../bling/entities/pedido-venda-rps.entity';
import { AdsController } from './ads.controller';
import { UpsertAdCampaignMetricUseCase } from './usecases/upsert-ad-campaign-metric.usecase';
import { ListAdCampaignMetricsUseCase } from './usecases/list-ad-campaign-metrics.usecase';
import { DeleteAdCampaignMetricUseCase } from './usecases/delete-ad-campaign-metric.usecase';
import { GetPaidTrafficPerformanceUseCase } from './usecases/get-paid-traffic-performance.usecase';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdCampaignMetric, CrmLead, PedidoVendaRPS]),
  ],
  controllers: [AdsController],
  providers: [
    UpsertAdCampaignMetricUseCase,
    ListAdCampaignMetricsUseCase,
    DeleteAdCampaignMetricUseCase,
    GetPaidTrafficPerformanceUseCase,
  ],
  exports: [
    TypeOrmModule,
    UpsertAdCampaignMetricUseCase,
    ListAdCampaignMetricsUseCase,
    DeleteAdCampaignMetricUseCase,
    GetPaidTrafficPerformanceUseCase,
  ],
})
export class AdsModule {}
