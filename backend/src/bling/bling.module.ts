import { RpsWorkerService } from './rps-worker.service';
import { LegacyAccountsService } from './legacy-accounts.service';
import { AccountContext } from './account-context';
import { AccountsService } from './accounts.service';
import { AccountInterceptor } from './account.interceptor';
import { AccountsController } from './accounts.controller';
import { BlingCallbackController } from './bling-callback.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlingController } from './bling.controller';
import { BlingService } from './bling.service';
import { RpsService } from './rps.service';
import { BlingIntegration } from './entities/bling-integration.entity';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';
import { GetBlingExecutiveSummaryUseCase } from './usecases/get-bling-executive-summary.usecase';
import { SearchBlingOrdersRpsUseCase } from './usecases/search-bling-orders-rps.usecase';

@Module({
  imports: [TypeOrmModule.forFeature([BlingIntegration, PedidoVendaRPS])],
  controllers: [AccountsController, BlingCallbackController, BlingController],
  providers: [
    RpsWorkerService,
    LegacyAccountsService,
    BlingService,
    RpsService,
    AccountContext,
    AccountsService,
    AccountInterceptor,
    GetBlingExecutiveSummaryUseCase,
    SearchBlingOrdersRpsUseCase,
  ],
  exports: [
    TypeOrmModule,
    BlingService,
    AccountsService,
    RpsService,
    GetBlingExecutiveSummaryUseCase,
    SearchBlingOrdersRpsUseCase,
  ], // Exportar para uso em outros módulos
})
export class BlingModule {}

