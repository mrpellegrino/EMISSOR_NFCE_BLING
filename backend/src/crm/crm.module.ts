import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmLead } from './entities/crm-lead.entity';
import { PedidoVendaRPS } from '../bling/entities/pedido-venda-rps.entity';
import { CrmController } from './crm.controller';
import { CaptureWebsiteLeadUseCase } from './usecases/capture-website-lead.usecase';
import { CreateLeadUseCase } from './usecases/create-lead.usecase';
import { ListLeadsUseCase } from './usecases/list-leads.usecase';
import { UpdateLeadUseCase } from './usecases/update-lead.usecase';
import { DeleteLeadUseCase } from './usecases/delete-lead.usecase';
import { GetCrmFunnelMetricsUseCase } from './usecases/get-crm-funnel-metrics.usecase';

@Module({
  imports: [TypeOrmModule.forFeature([CrmLead, PedidoVendaRPS])],
  controllers: [CrmController],
  providers: [
    CaptureWebsiteLeadUseCase,
    CreateLeadUseCase,
    ListLeadsUseCase,
    UpdateLeadUseCase,
    DeleteLeadUseCase,
    GetCrmFunnelMetricsUseCase,
  ],
  exports: [
    TypeOrmModule,
    CaptureWebsiteLeadUseCase,
    CreateLeadUseCase,
    ListLeadsUseCase,
    UpdateLeadUseCase,
    DeleteLeadUseCase,
    GetCrmFunnelMetricsUseCase,
  ],
})
export class CrmModule {}
