import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BlingModule } from './bling/bling.module';
import { CrmModule } from './crm/crm.module';
import { AdsModule } from './ads/ads.module';
import { McpModule } from './mcp/mcp.module';
import { User } from './users/entities/user.entity';
import { BlingIntegration } from './bling/entities/bling-integration.entity';
import { PedidoVendaRPS } from './bling/entities/pedido-venda-rps.entity';
import { CrmLead } from './crm/entities/crm-lead.entity';
import { AdCampaignMetric } from './ads/entities/ad-campaign-metric.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_NAME', 'emissor_nfce'),
        entities: [
          User,
          BlingIntegration,
          PedidoVendaRPS,
          CrmLead,
          AdCampaignMetric,
        ],
        synchronize: true, // Apenas em desenvolvimento! Em produção use migrations
        logging: true,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    BlingModule,
    CrmModule,
    AdsModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
