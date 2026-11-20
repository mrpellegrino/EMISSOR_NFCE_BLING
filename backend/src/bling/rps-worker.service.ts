import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlingIntegration } from './entities/bling-integration.entity';
import { AccountsService } from './accounts.service';
import { BlingService } from './bling.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class RpsWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RpsWorkerService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;
  readonly intervalMs = 500;

  constructor(
    @InjectRepository(BlingIntegration) private readonly repository: Repository<BlingIntegration>,
    private readonly accounts: AccountsService,
    private readonly bling: BlingService,
    private readonly config: ConfigService,
  ) {}

  getStatus() {
    return { enabled: String(this.config.get('AUTO_RPS_ENABLED', 'true')) !== 'false', intervalSeconds: this.intervalMs / 1000 };
  }

  onApplicationBootstrap() {
    if (!this.getStatus().enabled) return;
    this.stopped = false;
    this.schedule();
    this.logger.log('Processamento automático de RPS ativado.');
  }

  private schedule(delay = this.intervalMs) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.processCycle().finally(() => { this.running = undefined; this.schedule(); });
    }, delay);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  async processCycle() {
    try {
      // Discovery only: every subsequent read/write/API operation runs in its owner's account context.
      const eligible = await this.repository.createQueryBuilder('account')
        .innerJoin(User, 'owner', 'owner.id::text = account.userId AND owner.isActive = true')
        .where('account.isActive = true')
        .andWhere('account.accessToken IS NOT NULL AND account.refreshToken IS NOT NULL')
        .andWhere('account.clientId IS NOT NULL AND account.clientSecret IS NOT NULL')
        .andWhere('(account."rpsTargetStatus" = :targetStatus OR EXISTS (SELECT 1 FROM pedidos_venda_rps rps WHERE rps."accountId" = account.id AND rps.status IN (:...statuses)))', { targetStatus: 'ativa', statuses: ['pendente', 'processando'] })
        .orderBy('account.id', 'ASC').getMany();
      for (const account of eligible) {
        if (this.stopped) break;
        try {
          await this.accounts.run(account.userId, account.id, async () => {
            const status = this.bling.getIntegrationStatus();
            if (!status.isActive || !status.configured) return;
            // Reconcile in-flight notes and honor the queue switch even while a target
            // is generating more RPS. Generation must not starve enabled dispatch.
            await this.bling.processarFilaAutomatica();
            if (status.rpsTargetStatus === 'ativa') await this.bling.processarMetaRps();
          });
        } catch (error) {
          this.logger.warn('Falha na fila automática da conta ' + account.id + ': ' + error.message);
        }
      }
    } catch (error) {
      this.logger.error('Falha ao consultar fila automática: ' + error.message);
    }
  }
}
