import { RpsWorkerService } from './rps-worker.service';
import { Logger } from '@nestjs/common';

describe('RPS background worker', () => {
  let worker: RpsWorkerService;
  let query: any;
  let accounts: any;
  let bling: any;
  let enabled: boolean;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    enabled = true;
    query = { getMany: jest.fn().mockResolvedValue([{ id: 1, userId: 'a' }, { id: 2, userId: 'b' }]) };
    for (const method of ['innerJoin', 'where', 'andWhere', 'orderBy']) query[method] = jest.fn().mockReturnValue(query);
    accounts = { run: jest.fn(async (_owner, _id, action) => action()) };
    bling = { getIntegrationStatus: jest.fn().mockReturnValue({ isActive: true, configured: true }), processarFilaAutomatica: jest.fn().mockResolvedValue({}) };
    worker = new RpsWorkerService({ createQueryBuilder: () => query } as any, accounts, bling, { get: () => String(enabled) } as any);
  });
  afterEach(async () => { await worker.onModuleDestroy(); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('starts automatically, runs accounts independently, repeats and stops cleanly', async () => {
    bling.processarFilaAutomatica.mockRejectedValueOnce(new Error('account 1 disconnected'));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(499);
    expect(query.getMany).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(accounts.run.mock.calls.map(([user, id]) => [user, id])).toEqual([['a', 1], ['b', 2]]);
    expect(bling.processarFilaAutomatica).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(500);
    expect(bling.processarFilaAutomatica).toHaveBeenCalledTimes(4);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60000);
    expect(bling.processarFilaAutomatica).toHaveBeenCalledTimes(4);
  });

  it('services the queue before generating more RPS when a target is active', async () => {
    bling.getIntegrationStatus.mockReturnValue({ isActive: true, configured: true, rpsTargetStatus: 'ativa' });
    bling.processarMetaRps = jest.fn().mockResolvedValue({});
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    expect(bling.processarMetaRps).toHaveBeenCalledTimes(2);
    expect(bling.processarFilaAutomatica).toHaveBeenCalledTimes(2);
    expect(bling.processarFilaAutomatica.mock.invocationCallOrder[0]).toBeLessThan(bling.processarMetaRps.mock.invocationCallOrder[0]);
  });

  it('does not overlap cycles while the current batch is still running', async () => {
    let release!: () => void;
    bling.processarFilaAutomatica.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(60000);
    expect(query.getMany).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(500);
    expect(query.getMany).toHaveBeenCalledTimes(2);
  });

  it('skips an account disconnected while waiting for its turn', async () => {
    bling.getIntegrationStatus.mockReturnValueOnce({ isActive: false, configured: true });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    expect(bling.processarFilaAutomatica).toHaveBeenCalledTimes(1);
  });

  it('continues scheduling after a temporary database failure', async () => {
    query.getMany.mockRejectedValueOnce(new Error('DB unavailable'));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    expect(accounts.run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    expect(accounts.run).toHaveBeenCalledTimes(2);
  });

  it('does not start when explicitly disabled', async () => {
    enabled = false;
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60000);
    expect(query.getMany).not.toHaveBeenCalled();
  });
});
