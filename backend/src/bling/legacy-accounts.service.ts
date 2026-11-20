import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { BlingIntegration } from './entities/bling-integration.entity';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class LegacyAccountsService implements OnModuleInit {
  private readonly logger = new Logger(LegacyAccountsService.name);
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(72810401)');
      const accounts = manager.getRepository(BlingIntegration);
      if (await accounts.existsBy({ legacyImported: true })) return;
      const tokensPath = resolve(this.config.get('TOKENS_FILE', './tokens.json'));
      const credentialsPath = resolve(dirname(tokensPath), 'bling-config.json');
      const unassigned = await manager.getRepository(PedidoVendaRPS).countBy({ accountId: IsNull() });
      if (!existsSync(credentialsPath) && !existsSync(tokensPath) && !unassigned && !this.config.get('BLING_CLIENT_ID')) return;

      // Match the original integration before falling back to an explicit or sole owner.
      // A second login user does not make an exact existing integration ambiguous.
      const credentials = existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath, 'utf8')) : {};
      const clientId = credentials.client_id || this.config.get('BLING_CLIENT_ID') || null;
      const clientSecret = credentials.client_secret || this.config.get('BLING_CLIENT_SECRET') || null;
      const explicitOwner = this.config.get<string>('LEGACY_BLING_USER_ID');
      const matches = clientId && clientSecret ? await accounts.find({ where: { clientId, clientSecret } }) : [];
      if (matches.length > 1 || (matches.length === 1 && explicitOwner && matches[0].userId !== explicitOwner)) {
        this.logger.warn('Importação antiga não aplicada: credenciais associadas a contas ambíguas ou a outro proprietário.');
        return;
      }
      let account: BlingIntegration | null = matches[0] ?? null;
      if (!account) {
        const users = manager.getRepository(User);
        const owner = explicitOwner ? await users.findOneBy({ id: explicitOwner })
          : await users.count() === 1 ? await users.findOne({ where: {} }) : null;
        if (!owner) {
          this.logger.warn('Integração antiga preservada, sem proprietário definido. Configure LEGACY_BLING_USER_ID para importar credenciais e RPS antigos.');
          return;
        }
        account = await accounts.findOne({ where: { userId: owner.id, clientId: IsNull() }, order: { id: 'ASC' } });
        account ??= accounts.create({ userId: owner.id, name: 'Conta original' });
      }

      // Never replace newer database tokens with an obsolete token file, or mix token pairs.
      if (!account.accessToken && !account.refreshToken) {
        const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, 'utf8')) : {};
        account.accessToken = tokens.access_token || null;
        account.refreshToken = tokens.refresh_token || null;
        account.expiresAt = tokens.expires_at || null;
      }
      account.clientId ??= clientId;
      account.clientSecret ??= clientSecret;
      account.initialOrderNumber ??= credentials.initial_order_number ?? null;
      account.isActive = !!(account.accessToken && account.refreshToken);
      account.paymentMethodId ??= '2222749'; // Original installation's setting, only for imported accounts.
      account.legacyImported = true;
      account = await accounts.save(account);
      await manager.getRepository(PedidoVendaRPS).update({ accountId: IsNull() }, { accountId: account.id });
      this.logger.log('Integração original e histórico de RPS associados à conta ' + account.id);
    });
  }
}
