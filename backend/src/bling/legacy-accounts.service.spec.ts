import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LegacyAccountsService } from './legacy-accounts.service';
import { BlingIntegration } from './entities/bling-integration.entity';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';

describe('Legacy account import', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bling-migration-test-'));
    writeFileSync(join(directory, 'bling-config.json'), JSON.stringify({ client_id: 'legacy-client', client_secret: 'legacy-secret', initial_order_number: 50 }));
    writeFileSync(join(directory, 'tokens.json'), JSON.stringify({ access_token: 'legacy-token', refresh_token: 'legacy-refresh', expires_at: 1 }));
  });
  afterEach(() => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('bling-migration-test-')) {
      throw new Error('Refusing cleanup outside the test directory');
    }
    rmSync(target, { recursive: true, force: true });
  });

  function setup(userCount: number, explicitOwner?: string, existing?: Partial<BlingIntegration>, matchingAccounts?: Partial<BlingIntegration>[]) {
    let imported = false;
    const accounts = {
      existsBy: jest.fn(async () => imported),
      find: jest.fn(async () => matchingAccounts ?? (existing?.clientId === 'legacy-client' && existing?.clientSecret === 'legacy-secret' ? [existing] : [])),
      findOne: jest.fn(async () => existing ?? null),
      create: jest.fn(value => ({ id: 7, ...value })),
      save: jest.fn(async value => { imported = value.legacyImported; return value; }),
    };
    const rps = { countBy: jest.fn(async () => 2), update: jest.fn(async () => ({})) };
    const users = { count: jest.fn(async () => userCount), findOne: jest.fn(async () => ({ id: 'sole-owner' })), findOneBy: jest.fn(async ({ id }) => id === 'chosen-owner' ? { id } : null) };
    const manager = { query: jest.fn(), getRepository: entity => entity === BlingIntegration ? accounts : entity === PedidoVendaRPS ? rps : users };
    const db = { transaction: async action => action(manager) } as unknown as DataSource;
    const config = { get: (key: string) => ({ TOKENS_FILE: join(directory, 'tokens.json'), LEGACY_BLING_USER_ID: explicitOwner })[key] } as ConfigService;
    return { service: new LegacyAccountsService(db, config), accounts, rps };
  }

  it('imports once for the sole owner, preserving expired refresh tokens and the old history', async () => {
    const { service, accounts, rps } = setup(1);
    await service.onModuleInit(); await service.onModuleInit();
    expect(accounts.save).toHaveBeenCalledTimes(1);
    expect(accounts.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'sole-owner', clientId: 'legacy-client', refreshToken: 'legacy-refresh', expiresAt: 1, initialOrderNumber: 50, paymentMethodId: '2222749' }));
    expect(rps.update).toHaveBeenCalledWith(expect.anything(), { accountId: 7 });
  });

  it('preserves ambiguous global data without assigning it to a random user', async () => {
    const { service, accounts, rps } = setup(2);
    await service.onModuleInit();
    expect(accounts.save).not.toHaveBeenCalled();
    expect(rps.update).not.toHaveBeenCalled();
  });

  it('recovers history for the uniquely matching account even with several login users', async () => {
    const current = { id: 1, userId: 'original-owner', clientId: 'legacy-client', clientSecret: 'legacy-secret',
      accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 9999999999999,
      initialOrderNumber: 15141, paymentMethodId: '789' };
    const { service, accounts, rps } = setup(2, undefined, current);
    await service.onModuleInit();
    expect(accounts.create).not.toHaveBeenCalled();
    expect(accounts.findOne).not.toHaveBeenCalled();
    expect(accounts.save).toHaveBeenCalledWith(expect.objectContaining({ ...current, legacyImported: true }));
    expect(rps.update).toHaveBeenCalledWith(expect.anything(), { accountId: 1 });
  });

  it('does not guess when multiple accounts match the original credentials', async () => {
    const { service, accounts, rps } = setup(2, undefined, undefined, [{ id: 1 }, { id: 2 }]);
    await service.onModuleInit();
    expect(accounts.save).not.toHaveBeenCalled();
    expect(rps.update).not.toHaveBeenCalled();
  });

  it('does not import into an owner conflicting with the matching credentials', async () => {
    const { service, accounts, rps } = setup(2, 'chosen-owner', undefined, [{ id: 1, userId: 'different-owner' }]);
    await service.onModuleInit();
    expect(accounts.save).not.toHaveBeenCalled();
    expect(rps.update).not.toHaveBeenCalled();
  });

  it('uses the explicit owner and preserves their existing initial order setting', async () => {
    const { service, accounts } = setup(2, 'chosen-owner', { id: 9, userId: 'chosen-owner', initialOrderNumber: 123 });
    await service.onModuleInit();
    expect(accounts.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'chosen-owner' }) }));
    expect(accounts.save).toHaveBeenCalledWith(expect.objectContaining({ id: 9, initialOrderNumber: 123 }));
  });
});
