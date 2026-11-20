import { RpsWorkerService } from './rps-worker.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, FindOperator } from 'typeorm';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { BlingIntegration } from './entities/bling-integration.entity';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';
import { AccountContext } from './account-context';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { AccountInterceptor } from './account.interceptor';
import { BlingController } from './bling.controller';
import { BlingCallbackController } from './bling-callback.controller';
import { BlingService } from './bling.service';
import { RpsService } from './rps.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthenticateWithEnvCredentialsUseCase } from '../auth/usecases/authenticate-with-env-credentials.usecase';
import { UsersService } from '../users/users.service';

function memoryRepository<T extends { id: number }>(rows: T[]) {
  const matches = (row: T, where: object) => Object.entries(where).every(([key, value]) =>
    value instanceof FindOperator ? (value.type === 'isNull' ? row[key] == null : row[key] > value.value) : row[key] === value);
  return {
    rows,
    create: (value: Partial<T>) => ({ ...value }),
    save: jest.fn(async (value: T) => {
      const saved = { ...value, id: value.id ?? Math.max(0, ...rows.map(r => r.id)) + 1 };
      const index = rows.findIndex(r => r.id === saved.id);
      if (index < 0) rows.push(saved); else rows[index] = { ...rows[index], ...saved };
      return { ...(index < 0 ? saved : rows[index]) };
    }),
    find: jest.fn(async ({ where }) => rows.filter(row => matches(row, where)).map(row => ({ ...row }))),
    findOne: jest.fn(async ({ where }) => {
      const row = rows.find(row => matches(row, where));
      return row ? { ...row } : null;
    }),
    count: jest.fn(async ({ where }) => rows.filter(row => matches(row, where)).length),
    sum: jest.fn(async (column, where) => rows.filter(row => matches(row, where)).reduce((total, row) => total + Number(row[column] || 0), 0)),
    delete: jest.fn(async where => {
      let affected = 0;
      const conditions = Array.isArray(where) ? where : [where];
      for (let index = rows.length - 1; index >= 0; index--) {
        if (conditions.some(condition => matches(rows[index], condition))) { rows.splice(index, 1); affected++; }
      }
      return { affected };
    }),
    update: jest.fn(async (where, values) => {
      const selected = rows.filter(row => matches(row, where));
      selected.forEach(row => Object.assign(row, values));
      return { affected: selected.length };
    }),
    createQueryBuilder: () => {
      let filters = {}; let skip = 0; let take = 20;
      const builder = {
        where: (_sql, params) => { filters = params; return builder; },
        andWhere: (_sql, params) => { Object.assign(filters, params); return builder; },
        orderBy: () => builder,
        skip: value => { skip = value; return builder; },
        take: value => { take = value; return builder; },
        getManyAndCount: async () => {
          const result = rows.filter(row => matches(row, filters));
          return [result.slice(skip, skip + take), result.length];
        },
      };
      return builder;
    },
  };
}

const account = (id: number, userId = 'owner') => Object.assign(new BlingIntegration(), {
  id, userId, name: 'Conta ' + id, clientId: 'client-' + id, clientSecret: 'secret-' + id,
  accessToken: 'token-' + id, refreshToken: 'refresh-' + id, expiresAt: Date.now() + 3600000,
  initialOrderNumber: id * 100, serviceCode: '050801', installment: id, paymentMethodId: String(id),
});

describe('Independent Bling accounts', () => {
  let app: INestApplication;
  let context: AccountContext;
  let accounts: AccountsService;
  let bling: BlingService;
  let rps: RpsService;
  let repo: ReturnType<typeof memoryRepository<BlingIntegration>>;
  let rpsRepo: ReturnType<typeof memoryRepository<PedidoVendaRPS>>;
  const token = new JwtService({ secret: 'test-only' }).sign({ sub: 'owner', email: 'owner@example.test' });
  const originalFetch = global.fetch;
  const call = (method: string, path: string, id?: number) => {
    const req = request(app.getHttpServer())[method]('/bling/' + path).set('Authorization', 'Bearer ' + token);
    return id === undefined ? req : req.set('X-Account-Id', String(id));
  };

  beforeEach(async () => {
    repo = memoryRepository([account(1), account(2), account(3, 'someone-else')]);
    rpsRepo = memoryRepository([
      Object.assign(new PedidoVendaRPS(), { id: 11, accountId: 1, pedidoVendaId: '99', status: 'pendente', nfseId: '1001' }),
      Object.assign(new PedidoVendaRPS(), { id: 22, accountId: 2, pedidoVendaId: '99', status: 'emitido', nfseId: '1002', valorTotal: 123.45 }),
      Object.assign(new PedidoVendaRPS(), { id: 33, accountId: null, pedidoVendaId: '88', status: 'pendente' }),
    ]);
    const module = await Test.createTestingModule({
      controllers: [AccountsController, BlingCallbackController, BlingController],
      providers: [RpsWorkerService, AccountContext, AccountsService, AccountInterceptor, BlingService, RpsService, JwtStrategy,
        { provide: ConfigService, useValue: { get: (key, fallback) => key === 'JWT_SECRET' ? 'test-only' : key === 'AUTO_RPS_ENABLED' ? 'false' : fallback } },
        { provide: UsersService, useValue: { findById: async id => ({ id, isActive: true }) } },
        {
          provide: AuthenticateWithEnvCredentialsUseCase,
          useValue: {
            validateJwtPayload: (p: { sub: string; email?: string }) => ({
              id: p.sub,
              email: p.email ?? 'owner@example.test',
              name: 'Owner',
            }),
          },
        },
        { provide: getRepositoryToken(BlingIntegration), useValue: repo },
        { provide: getRepositoryToken(PedidoVendaRPS), useValue: rpsRepo },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    context = module.get(AccountContext); accounts = module.get(AccountsService);
    bling = module.get(BlingService); rps = module.get(RpsService);
    jest.spyOn(bling as any, 'waitForBlingRateLimit').mockResolvedValue(undefined);
  });
  afterEach(async () => { global.fetch = originalFetch; jest.restoreAllMocks(); await app.close(); });

  it('requires login on all operational endpoints and rejects missing/foreign accounts', async () => {
    for (const [method, path] of [['get', 'integration'], ['post', 'integration'], ['get', 'authorize'], ['post', 'set-tokens'], ['get', 'fila-rps'], ['get', 'fila-rps/automacao'], ['post', 'enviar-nfse'], ['delete', 'integration'], ['get', 'accounts']]) {
      await request(app.getHttpServer())[method]('/bling/' + path).expect(401);
    }
    await call('get', 'integration').expect(400);
    await call('get', 'integration', 3).expect(404);
    await call('post', 'deactivate', 3).expect(404);
    expect(repo.rows[2].accessToken).toBe('token-3');
  });

  it('lists only owned accounts, omits secrets, and creates an independent blank account', async () => {
    const list = await call('get', 'accounts').expect(200);
    expect(list.body.map(a => a.id)).toEqual([1, 2]);
    expect(JSON.stringify(list.body)).not.toMatch(/secret-|token-|refresh-/);
    await call('post', 'accounts').send({ name: '   ' }).expect(400);
    const created = await call('post', 'accounts').send({ name: 'Filial' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Filial', configured: false, isActive: false });
    expect(repo.rows.find(a => a.id === created.body.id)?.accessToken).toBeUndefined();
  });

  it('isolates settings, token removal and persistence after a fresh context', async () => {
    await call('post', 'integration/initial-order', 1).send({ initialOrderNumber: 1234 }).expect(201);
    await call('post', 'integration', 2).send({ clientId: 'client-2', clientSecret: '', paymentMethodId: '555' }).expect(201);
    expect(repo.rows[1].clientSecret).toBe('secret-2');
    expect(repo.rows[1].accessToken).toBe('token-2');
    await call('post', 'deactivate', 1).expect(201);
    expect((await call('get', 'integration', 1)).body).toMatchObject({ initialOrderNumber: 1234, isActive: false });
    expect((await call('get', 'integration', 2)).body).toMatchObject({ initialOrderNumber: 200, isActive: true, paymentMethodId: '555' });
    await call('delete', 'integration', 1).expect(200);
    expect(repo.rows[1].accessToken).toBe('token-2');
    expect(rpsRepo.rows).toHaveLength(3);
  });

  it('lists all active payment pages using the selected account and persists the selected ID', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 100, descricao: 'Forma ' + index, situacao: 1 }));
    global.fetch = jest.fn(async (url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-2');
      expect(new Headers(init?.headers).get('enable-jwt')).toBe('1');
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/Api/v3/formas-pagamentos');
      expect(parsed.searchParams.get('limite')).toBe('100');
      expect(parsed.searchParams.get('situacao')).toBe('1');
      return Response.json({ data: parsed.searchParams.get('pagina') === '1' ? firstPage : [{ id: 555, descricao: 'PIX', situacao: 1 }] });
    }) as typeof fetch;
    const response = await call('get', 'formas-pagamentos', 2).expect(200);
    expect(response.body.data).toHaveLength(101);
    expect(response.body.data[100]).toEqual({ id: 555, descricao: 'PIX' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await call('post', 'integration', 2).send({ clientId: 'client-2', clientSecret: '', paymentMethodId: String(response.body.data[100].id) }).expect(201);
    expect((await call('get', 'integration', 2)).body.paymentMethodId).toBe('555');
    expect(repo.rows[0].paymentMethodId).toBe('1');
    await call('get', 'formas-pagamentos', 3).expect(404);
    await call('get', 'formas-pagamentos').expect(400);
    await request(app.getHttpServer()).get('/bling/formas-pagamentos').expect(401);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an empty payment list from a Bling failure without clearing the saved ID', async () => {
    global.fetch = jest.fn(async () => Response.json({ data: [] })) as typeof fetch;
    expect((await call('get', 'formas-pagamentos', 1).expect(200)).body).toEqual({ data: [] });
    global.fetch = jest.fn(async () => Response.json({ error: { message: 'Sem permissão' } }, { status: 403 })) as typeof fetch;
    await call('get', 'formas-pagamentos', 1).expect(400);
    expect(repo.rows[0].paymentMethodId).toBe('1');
  });

  it('starts generation with existing pending RPS and pauses automatic dispatch', async () => {
    rpsRepo.rows[0].valorTotal = 250;
    const status = await call('get', 'meta-rps', 1).expect(200);
    expect(status.body.valorGerado).toBe(250);
    await accounts.run('owner', 1, async () => {
      await expect(bling.configurarMetaRps(157000)).resolves.toMatchObject({ status: 'ativa' });
    });
    expect(repo.rows[0].rpsTargetStatus).toBe('ativa');
    expect(repo.rows[0].autoRpsEnabled).toBe(false);
  });

  it('counts pending, processing and failed dispatches as generated RPS for the account', async () => {
    rpsRepo.rows[0].valorTotal = 100;
    rpsRepo.rows.push(Object.assign(new PedidoVendaRPS(), { id: 44, accountId: 1, valorTotal: 50, status: 'processando' }));
    rpsRepo.rows.push(Object.assign(new PedidoVendaRPS(), { id: 55, accountId: 1, valorTotal: 25, status: 'erro' }));
    await accounts.run('owner', 1, async () => expect(await rps.obterValorGerado()).toBe(175));
  });

  it('generates with a pending queue and never submits a note to the municipality', async () => {
    repo.rows[0].rpsTarget = 1000;
    repo.rows[0].rpsTargetStatus = 'ativa';
    repo.rows[0].autoRpsEnabled = false;
    jest.spyOn(bling, 'getPedidosVenda').mockResolvedValue({ data: [{ id: 500, numero: 500, data: '2025-01-01' }] });
    const generate = jest.spyOn(bling, 'gerarRPSParaPedidos').mockResolvedValue({ resultados: [{ status: 'sucesso' }] });
    const send = jest.spyOn(bling, 'enviarNFSeParaPrefeitura');
    await accounts.run('owner', 1, () => bling.processarMetaRps());
    expect(generate).toHaveBeenCalledWith([500]);
    expect(send).not.toHaveBeenCalled();
  });

  it('stops the target after the historical generated total exceeds it', async () => {
    repo.rows[1].rpsTarget = 100;
    repo.rows[1].rpsTargetStatus = 'ativa';
    const search = jest.spyOn(bling, 'getPedidosVenda');
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(repo.rows[1].rpsTargetStatus).toBe('concluida');
    expect(search).not.toHaveBeenCalled();
  });

  it('searches all pages and creates the oldest eligible order only', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    const page = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, numero: 1000 + i, data: '2025-02-01', situacao: { id: 1 } }));
    jest.spyOn(bling, 'getPedidosVenda').mockImplementation(async ({ pagina }) => ({ data: pagina === 1 ? page : [{ id: 500, numero: 500, data: '2025-01-01', situacao: { id: 1 } }] }));
    const generate = jest.spyOn(bling, 'gerarRPSParaPedidos').mockResolvedValue({ resultados: [{ status: 'sucesso' }] });
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(generate).toHaveBeenCalledWith([500]);
    expect(repo.rows[1].rpsTargetStatus).toBe('ativa');
  });

  it('records a failed creation and continues with the next order without retrying it after restart', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    jest.spyOn(bling, 'getPedidosVenda').mockResolvedValue({ data: [
      { id: 500, numero: 500, data: '2025-01-01' },
      { id: 501, numero: 501, data: '2025-01-02' },
    ] });
    const generate = jest.spyOn(bling, 'gerarRPSParaPedidos')
      .mockResolvedValueOnce({ resultados: [{ status: 'erro', mensagem: 'sem confirmação' }] })
      .mockResolvedValue({ resultados: [{ status: 'sucesso' }] });
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(repo.rows[1].rpsTargetStatus).toBe('ativa');
    expect(repo.rows[1].rpsTargetFailures).toEqual([expect.objectContaining({ pedidoId: 500, mensagem: 'sem confirmação' })]);
    const status = await call('get', 'meta-rps', 2).expect(200);
    expect(status.body.progress.erros).toBe(1);
    await accounts.run('owner', 2, () => bling.cancelarMetaRps());
    await accounts.run('owner', 2, () => bling.configurarMetaRps(1000));
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(generate.mock.calls.map(([ids]) => ids)).toEqual([[500], [501]]);
    expect(repo.rows[1].rpsTargetFailures).toHaveLength(1);
    expect((await call('get', 'meta-rps', 1)).body.falhas).toEqual([]);
  });

  it('reuses the ordered candidate list across cycles and skips ignored orders once', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    const search = jest.spyOn(bling, 'getPedidosVenda').mockResolvedValue({ data: [
      { id: 502, numero: 502, data: '2025-01-03' },
      { id: 501, numero: 501, data: '2025-01-02' },
      { id: 500, numero: 500, data: '2025-01-01' },
    ] });
    const generate = jest.spyOn(bling, 'gerarRPSParaPedidos')
      .mockResolvedValueOnce({ resultados: [{ status: 'ignorado' }] })
      .mockResolvedValue({ resultados: [{ status: 'sucesso' }] });
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(search).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls.map(([ids]) => ids)).toEqual([[500], [501], [502]]);
    expect(rpsRepo.find).toHaveBeenCalledTimes(1);
  });

  it('exposes real scan progress while the next page is still loading', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(bling, 'getPedidosVenda').mockImplementation(async ({ pagina }) => {
      if (pagina === 1) return { data: Array.from({ length: 100 }, (_, i) => ({ id: 500 + i, numero: 500 + i, data: '2025-01-01' })) };
      reached(); await blocked; return { data: [] };
    });
    jest.spyOn(bling, 'gerarRPSParaPedidos').mockResolvedValue({ resultados: [{ status: 'sucesso' }] });
    const cycle = accounts.run('owner', 2, () => bling.processarMetaRps());
    await waiting;
    try {
      const response = await call('get', 'meta-rps', 2).timeout({ response: 1000 }).expect(200);
      expect(response.body.progress).toMatchObject({ stage: 'buscando', paginas: 1, candidatos: 100, gerados: 0, running: true });
    } finally { release(); await cycle; }
  });

  it('shows a live creation as working and reports the confirmed last RPS afterwards', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(bling, 'getPedidosVenda').mockResolvedValue({ data: [{ id: 500, numero: 500, data: '2025-01-01' }] });
    jest.spyOn(bling, 'gerarRPSParaPedidos').mockImplementation(async () => {
      reached(); await blocked;
      await rps.criar({ pedidoVendaId: '500', numeroPedido: '500', numeroRPS: 'R500', status: 'pendente', valorTotal: 25, nomeCliente: 'Teste' });
      return { resultados: [{ status: 'sucesso' }] };
    });
    const cycle = accounts.run('owner', 2, () => bling.processarMetaRps());
    await waiting;
    try {
      const live = await call('get', 'meta-rps', 2).expect(200);
      expect(live.body.falhas).toEqual([]);
      expect(live.body).toMatchObject({ status: 'ativa', message: null, progress: { stage: 'gerando', pedidoAtual: 500, gerados: 0 } });
      expect((await call('get', 'meta-rps', 1)).body.progress).toBeNull();
    } finally { release(); await cycle; }
    const done = await call('get', 'meta-rps', 2).expect(200);
    expect(done.body.progress).toMatchObject({ gerados: 1, running: false, ultimoRps: { pedido: '500', numeroRps: 'R500', valor: 25 } });
  });

  it('finishes immediately when a newly created pending RPS crosses the target', async () => {
    repo.rows[1].rpsTarget = 1000;
    repo.rows[1].rpsTargetStatus = 'ativa';
    jest.spyOn(bling, 'getPedidosVenda').mockResolvedValue({ data: [{ id: 500, numero: 500, data: '2025-01-01' }] });
    jest.spyOn(bling, 'gerarRPSParaPedidos').mockImplementation(async () => {
      await rps.criar({ pedidoVendaId: '500', numeroPedido: '500', valorTotal: 900, status: 'pendente', nomeCliente: 'Teste' });
      return { resultados: [{ status: 'sucesso' }] };
    });
    const send = jest.spyOn(bling, 'enviarNFSeParaPrefeitura');
    await accounts.run('owner', 2, () => bling.processarMetaRps());
    expect(repo.rows[1].rpsTargetStatus).toBe('concluida');
    expect(send).not.toHaveBeenCalled();
    expect(rpsRepo.rows.find(row => row.pedidoVendaId === '500')?.status).toBe('pendente');
  });

  it('isolates queues, status filters, statistics and overlapping external order IDs', async () => {
    expect((await call('get', 'fila-rps', 1)).body.data.map(r => r.id)).toEqual([11]);
    expect((await call('get', 'fila-rps?status=emitido', 1)).body.total).toBe(0);
    expect((await call('get', 'fila-rps/estatisticas', 2)).body).toEqual({ pendentes: 0, processando: 0, emitidos: 1, erros: 0, valorEmitido: 123.45 });
    await accounts.run('owner', 1, async () => {
      expect((await rps.buscarPorPedidoId(99))?.id).toBe(11);
      expect(await rps.buscarPorId(22)).toBeNull();
      expect(await rps.atualizar(22, { status: 'erro' })).toBeNull();
    });
    expect(rpsRepo.rows[1].status).toBe('emitido');
    await accounts.run('owner', 2, async () => {
      expect((await rps.buscarPorPedidoId(99))?.id).toBe(22);
      const created = await rps.criar({ pedidoVendaId: '101', numeroPedido: '1', status: 'pendente', valorTotal: 1, nomeCliente: 'Teste' });
      expect(created.accountId).toBe(2);
    });
  });

  it('never submits another account RPS to Bling', async () => {
    global.fetch = jest.fn() as typeof fetch;
    const result = await call('post', 'enviar-nfse', 1).send({ rpsIds: [22] }).expect(201);
    expect(result.body.enviados).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('resets a processing RPS to issued when confirmed by Bling, without sending again', async () => {
    rpsRepo.rows[0].status = 'processando';
    global.fetch = jest.fn(async () => Response.json({ data: { situacao: 1, numero: '123' } })) as typeof fetch;
    const result = await call('post', 'fila-rps/11/resetar', 1).expect(201);
    expect(result.body.status).toBe('emitido');
    expect(rpsRepo.rows[0]).toMatchObject({ status: 'emitido', numeroNFSe: '123' });
    expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
    await call('post', 'fila-rps/11/resetar', 1).expect(201);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'missing'])('resets %s processing to manual review and preserves the record', async kind => {
    rpsRepo.rows[0].status = 'processando';
    global.fetch = jest.fn(async () => kind === 'pending'
      ? Response.json({ data: { situacao: 0 } })
      : Response.json({ error: { type: 'RESOURCE_NOT_FOUND' } }, { status: 404 })) as typeof fetch;
    const result = await call('post', 'fila-rps/11/resetar', 1).expect(201);
    expect(result.body.status).toBe('erro');
    expect(rpsRepo.rows[0]).toMatchObject({ id: 11, status: 'erro', nfseId: '1001' });
    expect(rpsRepo.rows[0].mensagemErro).toContain('revisão manual');
    expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
  });

  it('preserves processing on reset connection failure and enforces account ownership', async () => {
    rpsRepo.rows[0].status = 'processando';
    global.fetch = jest.fn(async () => { throw new Error('Bling indisponível'); }) as typeof fetch;
    await call('post', 'fila-rps/11/resetar', 1).expect(400);
    expect(rpsRepo.rows[0].status).toBe('processando');
    (global.fetch as jest.Mock).mockClear();
    await call('post', 'fila-rps/22/resetar', 1).expect(400);
    await call('post', 'fila-rps/11/resetar', 3).expect(404);
    await request(app.getHttpServer()).post('/bling/fila-rps/11/resetar').expect(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('binds concurrent OAuth flows to the correct account and rejects replay/expiration', async () => {
    const urls = await Promise.all([call('get', 'authorize', 1), call('get', 'authorize', 2)]);
    const states = urls.map(r => new URL(r.body.authorizationUrl).searchParams.get('state'));
    global.fetch = jest.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get('enable-jwt')).toBe('1');
      const authorization = new Headers(init?.headers).get('Authorization');
      const id = authorization === 'Basic ' + Buffer.from('client-1:secret-1').toString('base64') ? 1 : 2;
      return new Response(JSON.stringify({ access_token: 'new-' + id, refresh_token: 'new-refresh-' + id, expires_in: 3600 }));
    }) as typeof fetch;
    for (const id of [2, 1]) {
      const response = await request(app.getHttpServer()).get('/bling/callback').query({ state: states[id - 1], code: 'code' }).expect(302);
      expect(response.headers.location).toContain('account=' + id);
    }
    expect(repo.rows.slice(0, 2).map(a => a.accessToken)).toEqual(['new-1', 'new-2']);
    const replay = await request(app.getHttpServer()).get('/bling/callback').query({ state: states[0], code: 'code' }).expect(302);
    expect(replay.headers.location).toContain('bling=error');
    const fresh = await call('get', 'authorize', 1);
    repo.rows[0].oauthStateExpiresAt = Date.now() - 1;
    const expired = await request(app.getHttpServer()).get('/bling/callback').query({ state: new URL(fresh.body.authorizationUrl).searchParams.get('state'), code: 'code' });
    expect(expired.headers.location).toContain('bling=error');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('requests JWT on refresh and persists long tokens', async () => {
    const jwt = 'a'.repeat(3000);
    global.fetch = jest.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get('enable-jwt')).toBe('1');
      expect(new URLSearchParams(init?.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
      return Response.json({ access_token: jwt, refresh_token: 'r'.repeat(3000), expires_in: 3600 });
    }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.refreshAccessToken());
    expect(repo.rows[0].accessToken).toBe(jwt);
    expect(repo.rows[0].refreshToken).toHaveLength(3000);
  });

  it('keeps asynchronous API calls pinned to their account', async () => {
    const headers: string[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      headers.push(new Headers(init?.headers).get('Authorization')!);
      return new Response('{}');
    }) as typeof fetch;
    await Promise.all([1, 2].map(id => accounts.run('owner', id, async () => {
      await new Promise(resolve => setTimeout(resolve, id === 1 ? 10 : 1));
      expect(context.account.id).toBe(id);
      await bling.makeAuthenticatedRequest('/Api/v3/contatos');
    })));
    expect(headers.sort()).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('reports the automation state for the selected account only', async () => {
    expect((await call('get', 'fila-rps/automacao', 1).expect(200)).body).toEqual({ enabled: false, globalEnabled: false, accountEnabled: true, connected: true, intervalSeconds: 0.5 });
    await call('get', 'fila-rps/automacao', 3).expect(404);
  });

  it('serves local queue reads while emission holds the account lock, preserving ownership checks', async () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const emission = accounts.run('owner', 1, async () => { started(); await blocked; });
    await ready;
    try {
      const stats = await call('get', 'fila-rps/estatisticas', 1).timeout({ response: 1000 }).expect(200);
      expect(stats.body).toEqual({ pendentes: 1, processando: 0, emitidos: 0, erros: 0, valorEmitido: 0 });
      const queue = await call('get', 'fila-rps', 1).timeout({ response: 1000 }).expect(200);
      expect(queue.body.data.map(row => row.id)).toEqual([11]);
      await call('get', 'fila-rps/automacao', 1).timeout({ response: 1000 }).expect(200);
      for (const path of ['fila-rps', 'fila-rps/estatisticas', 'fila-rps/automacao']) {
        await call('get', path, 3).expect(404);
        await call('get', path).expect(400);
        await request(app.getHttpServer()).get('/bling/' + path).expect(401);
      }
    } finally {
      release();
      await emission;
    }
  });

  it('claims concurrent manual/automatic submissions atomically and posts once', async () => {
    global.fetch = jest.fn(async (_url, init) => Response.json({ data: init?.method === 'POST' ? { situacao: 1, numero: '50' } : { situacao: 0 } })) as typeof fetch;
    // Bypass in-process serialization to also exercise the DB claim used across callers.
    await Promise.all([
      context.run(repo.rows[0], () => bling.enviarNFSeParaPrefeitura([11, 11])),
      context.run({ ...repo.rows[0] }, () => bling.enviarNFSeParaPrefeitura([11], true)),
    ]);
    expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(rpsRepo.rows[0]).toMatchObject({ status: 'emitido', numeroNFSe: '50' });
    expect(rpsRepo.rows[1].status).toBe('emitido');
  });

  it('automatically processes pending rows only in the selected account', async () => {
    rpsRepo.rows[1].status = 'pendente';
    global.fetch = jest.fn(async (_url, init) => Response.json({ data: { situacao: init?.method === 'POST' ? 1 : 0 } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows.map(row => row.status)).toEqual(['emitido', 'pendente', 'pendente']);
    expect((global.fetch as jest.Mock).mock.calls.every(([url, init]) => String(url).includes('/1001') && new Headers(init.headers).get('Authorization') === 'Bearer token-1')).toBe(true);
  });

  it('blocks a future-dated existing note and allows retry after its date is corrected in Bling', async () => {
    jest.spyOn(bling as any, 'dataEmissaoHoje').mockReturnValue('2026-09-30');
    rpsRepo.rows[0].status = 'erro';
    global.fetch = jest.fn(async () => Response.json({ data: { situacao: 0, dataEmissao: '2026-10-01' } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11]));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rpsRepo.rows[0].status).toBe('erro');
    expect(rpsRepo.rows[0].mensagemErro).toContain('01/10/2026');
    expect(rpsRepo.rows[0].mensagemErro).toContain('30/09/2026');
    global.fetch = jest.fn(async (_url, init) => Response.json({ data: init?.method === 'POST'
      ? { situacao: 1, numero: '53' } : { situacao: 0, dataEmissao: '2026-09-30' } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11]));
    expect(rpsRepo.rows[0]).toMatchObject({ status: 'emitido', numeroNFSe: '53', mensagemErro: '' });
  });

  it('explains E0008 even with a valid calendar date and does not retry automatically', async () => {
    jest.spyOn(bling as any, 'dataEmissaoHoje').mockReturnValue('2026-09-30');
    global.fetch = jest.fn(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: {
        type: 'VALIDATION_ERROR', message: 'Não foi possível emitir a Nota de Serviço',
        fields: [{ message: 'Código: E0008; A data de emissão da DPS não pode ser posterior à data do seu processamento.' }],
      } }, { status: 400 })
      : Response.json({ data: { situacao: 0, dataEmissao: '2026-09-30' } })) as typeof fetch;

    const resultado = await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11]));
    expect(rpsRepo.rows[0]).toMatchObject({ status: 'erro', nfseId: '1001' });
    expect(rpsRepo.rows[0].mensagemErro).toContain('Rejeição E0008');
    expect(rpsRepo.rows[0].mensagemErro).toContain('data/hora');
    expect(rpsRepo.rows[0].mensagemErro).toContain('mesma nota');
    expect(resultado.resultados[0].mensagem).toBe(rpsRepo.rows[0].mensagemErro);
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it.each([1, 2, 3])('does not submit a remote note with situation %s', async situacao => {
    global.fetch = jest.fn(async () => Response.json({ data: { situacao } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rpsRepo.rows[0].status).toBe(situacao === 3 ? 'erro' : 'emitido');
  });

  it.each(['timeout', 'server error'])('only polls after an uncertain POST (%s), even when Bling still reports pending', async failure => {
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.method === 'POST') {
        if (failure === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
        return Response.json({ error: { message: 'Unavailable' } }, { status: 503 });
      }
      return Response.json({ data: { situacao: 0 } });
    }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows[0].status).toBe('processando');
    // Another cycle or manual click must not retry the POST.
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11]));
    expect(rpsRepo.rows[0].status).toBe('processando');
    expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    global.fetch = jest.fn(async () => Response.json({ data: { situacao: 1, numero: '51' } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows[0]).toMatchObject({ status: 'emitido', numeroNFSe: '51', mensagemErro: '' });
  });

  it('retries safe preflight failures but does not retry rejected submissions automatically', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network'); }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows[0].status).toBe('pendente');
    global.fetch = jest.fn(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: { message: 'Invalid note' } }, { status: 400 })
      : Response.json({ data: { situacao: 0 } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows[0].status).toBe('erro');
    const calls = (global.fetch as jest.Mock).mock.calls.length;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11], true));
    expect(global.fetch).toHaveBeenCalledTimes(calls);
    // Explicit retry is allowed after review; preflight still checks the remote note.
    global.fetch = jest.fn(async () => Response.json({ data: { situacao: 1, numero: '52' } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.enviarNFSeParaPrefeitura([11]));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rpsRepo.rows[0].status).toBe('emitido');
  });

  it('preserves issued/processing statuses when synchronization cannot reach Bling', async () => {
    rpsRepo.rows[0].status = 'processando';
    global.fetch = jest.fn(async () => { throw new Error('Network'); }) as typeof fetch;
    for (const id of [1, 2]) await accounts.run('owner', id, () => bling.sincronizarStatusNFSe());
    expect(rpsRepo.rows.slice(0, 2).map(row => row.status)).toEqual(['processando', 'emitido']);
  });

  it('does not let a stale synchronization release a row claimed by a sender', async () => {
    global.fetch = jest.fn(async () => {
      rpsRepo.rows[0].status = 'processando';
      return Response.json({ data: { situacao: 0 } });
    }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.sincronizarStatusNFSe());
    expect(rpsRepo.rows[0].status).toBe('processando');
    await accounts.run('owner', 2, async () => {
      expect(await rps.iniciarEnvio(11, 'pendente')).toBe(false);
      expect(await rps.atualizarSeStatus(11, 'processando', { status: 'pendente' })).toBe(false);
    });
  });

  it.each(['pendente', 'erro'])('removes a missing %s RPS only from its account and releases the order', async status => {
    rpsRepo.rows[0].status = status;
    global.fetch = jest.fn(async () => Response.json({ error: { type: 'RESOURCE_NOT_FOUND' } }, { status: 404 })) as typeof fetch;
    const result = await call('post', 'sincronizar-nfse', 1).expect(201);
    expect(result.body).toMatchObject({ verificados: 1, removidos: 1, falhas: 0 });
    expect(rpsRepo.rows.map(row => row.id)).toEqual([22, 33]);
    expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
    await accounts.run('owner', 1, async () => {
      expect(await rps.buscarPorPedidoId('99')).toBeNull();
      await rps.criar({ pedidoVendaId: '99', numeroPedido: '99', status: 'pendente', nfseId: '2001', valorTotal: 10, nomeCliente: 'Teste' });
      expect((await rps.buscarPorPedidoId('99'))?.nfseId).toBe('2001');
    });
  });

  it.each([401, 403, 429, 500, 404])('preserves rows on an unconfirmed failure (%s)', async status => {
    rpsRepo.rows[0].status = 'erro';
    global.fetch = jest.fn(async () => Response.json({ error: { type: 'OTHER_ERROR' } }, { status })) as typeof fetch;
    const result = await call('post', 'sincronizar-nfse', 1).expect(201);
    expect(result.body).toMatchObject({ removidos: 0, falhas: 1 });
    expect(rpsRepo.rows[0].id).toBe(11);
    expect(rpsRepo.delete).not.toHaveBeenCalled();
  });

  it.each(['processando', 'emitido', 'numbered'])('preserves %s history even when Bling reports not found', async kind => {
    rpsRepo.rows[0].status = kind === 'numbered' ? 'erro' : kind;
    if (kind === 'numbered') rpsRepo.rows[0].numeroNFSe = '123';
    global.fetch = jest.fn(async () => Response.json({ error: { type: 'RESOURCE_NOT_FOUND' } }, { status: 404 })) as typeof fetch;
    const result = await call('post', 'sincronizar-nfse', 1).expect(201);
    expect(result.body.removidos).toBe(0);
    expect(rpsRepo.rows[0].id).toBe(11);
  });

  it('does not delete a row claimed concurrently or belonging to another account', async () => {
    global.fetch = jest.fn(async () => {
      rpsRepo.rows[0].status = 'processando';
      return Response.json({ error: { type: 'RESOURCE_NOT_FOUND' } }, { status: 404 });
    }) as typeof fetch;
    expect((await call('post', 'sincronizar-nfse', 1).expect(201)).body.removidos).toBe(0);
    expect(rpsRepo.rows[0].status).toBe('processando');
    await accounts.run('owner', 2, async () => {
      expect(await rps.removerExcluidoNoBling({ ...rpsRepo.rows[0], status: 'pendente' })).toBe(false);
    });
    expect(rpsRepo.rows).toHaveLength(3);
  });

  it('collects every page before deleting missing RPS records', async () => {
    jest.spyOn(bling['logger'], 'error').mockImplementation(() => undefined);
    const items = Array.from({ length: 1001 }, (_, index) => Object.assign(new PedidoVendaRPS(), {
      id: 100 + index, accountId: 1, pedidoVendaId: String(100 + index), status: 'erro', nfseId: String(2000 + index),
    }));
    rpsRepo.rows.splice(0, rpsRepo.rows.length, ...items);
    global.fetch = jest.fn(async () => Response.json({ error: { type: 'RESOURCE_NOT_FOUND' } }, { status: 404 })) as typeof fetch;
    const result = await accounts.run('owner', 1, () => bling.sincronizarStatusNFSe());
    expect(result).toMatchObject({ verificados: 1001, removidos: 1001, falhas: 0 });
    expect(rpsRepo.rows).toHaveLength(0);
  });

  it('pauses immediately during an account operation and token saves cannot undo the pause', async () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const operation = accounts.run('owner', 1, async () => {
      started(); await gate;
      await bling.setInitialOrderNumber(300);
    });
    await ready;
    try {
      await call('post', 'accounts/1/automacao').send({ enabled: false }).timeout({ response: 1000 }).expect(201);
      expect(repo.rows[0].autoRpsEnabled).toBe(false);
      expect(repo.rows[1].autoRpsEnabled).not.toBe(false);
    } finally { release(); await operation; }
    expect(repo.rows[0].autoRpsEnabled).toBe(false);
    expect((await call('get', 'fila-rps/automacao', 1)).body.accountEnabled).toBe(false);
    await call('post', 'accounts/1/automacao').send({ enabled: true }).expect(201);
    expect((await call('get', 'fila-rps/automacao', 1)).body.accountEnabled).toBe(true);
    await call('post', 'accounts/3/automacao').send({ enabled: false }).expect(404);
    await call('post', 'accounts/1/automacao').send({ enabled: 'false' }).expect(400);
    await request(app.getHttpServer()).post('/bling/accounts/1/automacao').send({ enabled: false }).expect(401);
  });

  it('does not send pending notes while paused but still checks an in-flight note', async () => {
    repo.rows[0].autoRpsEnabled = false;
    global.fetch = jest.fn(async () => Response.json({ data: { situacao: 0 } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(global.fetch).not.toHaveBeenCalled();
    rpsRepo.rows[0].status = 'processando';
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rpsRepo.rows[0].status).toBe('processando');
  });

  it('returns a claimed note to pending if paused during the preflight request and resumes later', async () => {
    global.fetch = jest.fn(async () => {
      await accounts.setAutomation('owner', 1, false);
      return Response.json({ data: { situacao: 0 } });
    }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rpsRepo.rows[0].status).toBe('pendente');
    await accounts.setAutomation('owner', 1, true);
    global.fetch = jest.fn(async (_url, init) => Response.json({ data: { situacao: init?.method === 'POST' ? 1 : 0 } })) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows[0].status).toBe('emitido');
  });

  it('finishes an already submitted note but stops the rest of the batch when paused', async () => {
    rpsRepo.rows.push(Object.assign(new PedidoVendaRPS(), { id: 44, accountId: 1, pedidoVendaId: '100', nfseId: '1004', status: 'pendente' }));
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.method === 'POST') await accounts.setAutomation('owner', 1, false);
      return Response.json({ data: { situacao: init?.method === 'POST' ? 1 : 0 } });
    }) as typeof fetch;
    await accounts.run('owner', 1, () => bling.processarFilaAutomatica());
    expect(rpsRepo.rows.find(row => row.id === 11)?.status).toBe('emitido');
    expect(rpsRepo.rows.find(row => row.id === 44)?.status).toBe('pendente');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
