import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlingApi } from '../src/services/blingApi.ts';

test('pauses and resumes automation for the selected account', async () => {
  globalThis.localStorage = { getItem: () => 'session' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ accountEnabled: JSON.parse(options.body).enabled });
  };
  const api = createBlingApi(7);
  assert.deepEqual(await api.setRpsAutomation(false), { accountEnabled: false });
  assert.deepEqual(await api.setRpsAutomation(true), { accountEnabled: true });
  assert.ok(calls.every(call => call.url.endsWith('/accounts/7/automacao')));
  assert.ok(calls.every(call => call.method === 'POST' && call.headers['X-Account-Id'] === '7'));
  assert.deepEqual(calls.map(call => JSON.parse(call.body).enabled), [false, true]);
});

test('loads payment names for the selected account and saves the selected ID', async () => {
  globalThis.localStorage = { getItem: () => 'session' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(url.endsWith('/formas-pagamentos') ? { data: [{ id: 555, descricao: 'PIX' }] } : {});
  };
  const api = createBlingApi(7);
  const result = await api.getFormasPagamento();
  assert.equal(result.data[0].descricao, 'PIX');
  await api.saveBlingIntegration('client', '', null, String(result.data[0].id));
  assert.equal(calls[0].headers['X-Account-Id'], '7');
  assert.equal(calls[1].headers['X-Account-Id'], '7');
  assert.equal(JSON.parse(calls[1].body).paymentMethodId, '555');
});

test('statistics stop waiting after 15 seconds and a retry can succeed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.localStorage = { getItem: () => 'session' };
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const api = createBlingApi(1);
  const pending = api.getEstatisticasRPS();
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  t.mock.timers.tick(15000);
  await rejected;
  const counts = { pendentes: 2, processando: 1, emitidos: 4, erros: 0 };
  globalThis.fetch = async () => Response.json(counts);
  assert.deepEqual(await api.getEstatisticasRPS(), counts);
});

test('switching accounts still cancels statistics immediately', async () => {
  globalThis.localStorage = { getItem: () => 'session' };
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const api = createBlingApi(1);
  const pending = api.getEstatisticasRPS();
  api.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('requests remain bound to the original account and login', async () => {
  let token = 'session-a';
  globalThis.localStorage = { getItem: () => token };
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json({ data: [] }); };
  const accountA = createBlingApi(1);
  token = 'session-b';
  const accountB = createBlingApi(2);
  await Promise.all([accountA.gerarRPSPedidos([99]), accountB.getFilaRPS()]);
  assert.equal(calls[0].headers['X-Account-Id'], '1');
  assert.equal(calls[0].headers.Authorization, 'Bearer session-a');
  assert.equal(calls[1].headers['X-Account-Id'], '2');
  assert.equal(calls[1].headers.Authorization, 'Bearer session-b');
});

test('switching aborts pending requests and blocks delayed work on an unmounted screen', async () => {
  globalThis.localStorage = { getItem: () => 'session' };
  let calls = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const api = createBlingApi(1);
  const pending = api.getBlingIntegration();
  api.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(api.gerarRPSPedidos([99]), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('OAuth authorization uses the selected account and the app session', async () => {
  globalThis.localStorage = { getItem: () => 'session' };
  globalThis.fetch = async (url, { headers }) => {
    assert.equal(headers['X-Account-Id'], '7');
    assert.equal(headers.Authorization, 'Bearer session');
    assert.match(url, /authorize$/);
    return Response.json({ authorizationUrl: 'https://www.bling.com.br/test' });
  };
  assert.equal(await createBlingApi(7).getBlingAuthorizationUrl(), 'https://www.bling.com.br/test');
});
