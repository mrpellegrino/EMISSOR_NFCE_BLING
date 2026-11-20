import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccountsService } from '../../bling/accounts.service';
import { BlingApiException, BlingService } from '../../bling/bling.service';
import { FinanceMcpController } from './finance-mcp.controller';
import { FinanceMcpService } from './finance-mcp.service';

describe('Office finance MCP', () => {
  let app: INestApplication;
  const key = 'test-mcp-credential-not-for-production';
  const settings = ['OFFICE_FINANCE_MCP_KEY', 'OFFICE_FINANCE_MCP_USER_ID', 'OFFICE_FINANCE_MCP_ACCOUNT_IDS'] as const;
  const originalEnv = settings.map(name => process.env[name]);
  const list = jest.fn();
  const run = jest.fn((_owner: string, _id: number, action: () => unknown) => action());
  const upstream = jest.fn();
  const post = (method: string, params?: unknown, token = key) => request(app.getHttpServer())
    .post('/api/mcp/finance').set('Authorization', `Bearer ${token}`)
    .send({ jsonrpc: '2.0', id: 1, method, params });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FinanceMcpController],
      providers: [
        FinanceMcpService,
        { provide: AccountsService, useValue: { list, run } },
        { provide: BlingService, useValue: { makeAuthenticatedRequest: upstream } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OFFICE_FINANCE_MCP_KEY = key;
    process.env.OFFICE_FINANCE_MCP_USER_ID = 'dedicated-owner';
    process.env.OFFICE_FINANCE_MCP_ACCOUNT_IDS = '7';
  });

  afterAll(async () => {
    settings.forEach((name, index) => {
      const previous = originalEnv[index];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
    await app.close();
  });

  it('handshakes with Streamable HTTP and publishes only finance lookups', async () => {
    const init = await post('initialize', { protocolVersion: '2025-11-25' }).expect(200);
    expect(init.body.result.protocolVersion).toBe('2025-11-25');
    await request(app.getHttpServer()).post('/api/mcp/finance')
      .set('Authorization', `Bearer ${key}`)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202, '');
    const response = await post('tools/list').expect(200);
    expect(response.body.result.tools).toHaveLength(8);
    expect(response.body.result.tools.every(tool => tool.annotations.readOnlyHint)).toBe(true);
    const mutation = await post('tools/call', { name: 'create_crm_lead', arguments: {} }).expect(200);
    expect(mutation.body.result.isError).toBe(true);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed and rejects unwanted origins and accounts', async () => {
    await post('tools/list', {}, 'wrong-key').expect(401);
    await request(app.getHttpServer()).post('/api/mcp/finance')
      .set('Authorization', `Bearer ${key}`).set('Origin', 'https://example.invalid')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(403);
    const blocked = await post('tools/call', { name: 'finance_get_receivable', arguments: { accountId: 8, id: 2 } }).expect(200);
    expect(blocked.body.result.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
    delete process.env.OFFICE_FINANCE_MCP_ACCOUNT_IDS;
    await post('tools/list').expect(404);
  });

  it('only lists enabled accounts owned by the configured user', async () => {
    list.mockResolvedValueOnce([{ id: 7, name: 'Vila Pet', isActive: true }, { id: 8, name: 'Outra', isActive: true }]);
    const response = await post('tools/call', { name: 'finance_list_accounts' }).expect(200);
    expect(list).toHaveBeenCalledWith('dedicated-owner');
    expect(JSON.parse(response.body.result.content[0].text)).toEqual([{ id: 7, nome: 'Vila Pet', conectado: true }]);
  });

  it('translates date filters, limits pagination and omits links or personal data', async () => {
    const args = { accountId: 7, inicio: '2026-10-01', fim: '2026-10-31', base: 'liquidacao', situacao: 3, limite: 1 };
    upstream.mockResolvedValueOnce({ data: [{ id: 21, valor: 100, situacao: 3, contato: { nome: 'Privado' }, linkBoleto: 'privado' }] });
    const response = await post('tools/call', { name: 'finance_list_receivables', arguments: args }).expect(200);
    expect(run).toHaveBeenCalledWith('dedicated-owner', 7, expect.any(Function));
    expect(upstream).toHaveBeenCalledWith(
      '/Api/v3/contas/receber?tipoFiltroData=R&dataInicial=2026-10-01&dataFinal=2026-10-31&situacoes%5B%5D=3&pagina=1&limite=1',
      expect.objectContaining({ method: 'GET' }), false,
    );
    const text = response.body.result.content[0].text;
    expect(text).not.toMatch(/privado/i);
    expect(JSON.parse(text)).toMatchObject({ proximaPagina: 2, itens: [{ id: 21, valorOriginal: 100, saldoEmAberto: null }] });
    const invalid = await post('tools/call', { name: 'finance_list_payables', arguments: { ...args, inicio: '2026-02-31' } }).expect(200);
    expect(invalid.body.result.isError).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('returns financial detail and hides upstream error bodies', async () => {
    const params = { name: 'finance_get_payable', arguments: { accountId: 7, id: 30 } };
    upstream.mockResolvedValueOnce({ data: { id: 30, valor: 100, saldo: 37.25, competencia: '2026-10-01', categoria: { id: 42 }, borderos: [4] } });
    const found = await post('tools/call', params);
    expect(JSON.parse(found.body.result.content[0].text)).toMatchObject({
      titulo: { saldoEmAberto: 37.25, competencia: '2026-10-01', categoriaId: 42, borderoIds: [4] },
    });
    upstream.mockRejectedValueOnce(new BlingApiException(403, 'resposta interna do ERP'));
    const denied = await post('tools/call', params);
    expect(denied.body.result.isError).toBe(true);
    expect(denied.body.result.content[0].text).toMatch(/escopos/);
    expect(denied.body.result.content[0].text).not.toMatch(/resposta interna/);
  });
});
