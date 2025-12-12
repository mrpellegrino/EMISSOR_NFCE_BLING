import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlingController } from './bling.controller';
import { BlingService } from './bling.service';
import { RpsService } from './rps.service';
import { BlingIntegration } from './entities/bling-integration.entity';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BlingIntegration, PedidoVendaRPS])],
  controllers: [BlingController],
  providers: [BlingService, RpsService],
  exports: [BlingService, RpsService], // Exportar para uso em outros módulos
})
export class BlingModule {}

