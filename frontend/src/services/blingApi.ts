export interface RpsTargetProgress {
  stage: 'preparando' | 'buscando' | 'gerando' | 'aguardando' | 'pausada' | 'concluida' | 'erro' | 'sem_pedidos';
  running: boolean;
  updatedAt: string;
  paginas: number;
  candidatos: number;
  examinados: number;
  gerados: number;
  ignorados: number;
  erros: number;
  pedidoAtual: number | null;
  ultimoRps: { pedido: string; numeroRps: string | null; valor: number; at: string } | null;
  eventos: { at: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }[];
}

export interface MetaRpsStatus {
  target: number | null;
  status: string | null;
  message: string | null;
  valorGerado: number;
  progress: RpsTargetProgress | null;
  falhas: { pedidoId: number; numeroPedido: string; mensagem: string; at: string }[];
}

export interface PedidoVenda {
  id: number;
  numero: number;
  numeroLoja?: string;
  data: string;
  dataSaida?: string;
  dataPrevista?: string;
  totalProdutos?: number;
  total: number;
  contato?: {
    id: number;
    nome?: string;
    tipoPessoa?: string;
    numeroDocumento?: string;
  };
  situacao?: {
    id: number;
    valor: string;
  };
  loja?: {
    id: number;
  };
  rpsStatus?: 'pendente' | 'processando' | 'emitido' | 'erro';
  numeroRPS?: string;
  numeroNFSe?: string;
}

export interface PedidosVendaResponse {
  data: PedidoVenda[];
}

export interface PedidosVendaParams {
  pagina?: number;
  limite?: number;
  numero?: number;
  dataInicial?: string;
  dataFinal?: string;
  idContato?: number;
  idsSituacoes?: number[];
}

export interface BlingIntegrationStatus {
  configured: boolean;
  isActive: boolean;
  clientId?: string;
  hasClientSecret?: boolean;
  initialOrderNumber?: number | null;
  paymentMethodId?: string | null;
  tokenExpiresAt?: string;
  lastSyncAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveIntegrationResponse {
  message: string;
  configured: boolean;
  isActive: boolean;
}

export interface FormaPagamento {
  id: number;
  descricao: string;
}

export interface RpsAutomationStatus {
  enabled: boolean;
  globalEnabled: boolean;
  accountEnabled: boolean;
  connected: boolean;
  intervalSeconds: number;
}

export interface AuthorizationUrlResponse {
  authorizationUrl: string;
}

export interface FilaRpsParams {
  pagina?: number;
  limite?: number;
  status?: string;
}

export interface RpsRecord {
  id: number; pedidoVendaId: string; numeroPedido: string; numeroRPS: string | null;
  nfseId: string | null; numeroNFSe: string | null; nomeCliente: string;
  valorTotal: number | string; status: 'pendente' | 'processando' | 'emitido' | 'erro';
  mensagemErro: string | null; createdAt: string;
}
export interface RpsBatchResult { resultados: { status: string; mensagem?: string }[] }

// A client belongs to one screen/account for its entire lifetime, including delayed callbacks.
export const createBlingApi = (accountId: number) => {
  let controller = new AbortController();
  const sessionToken = localStorage.getItem('access_token');
  const API_URL = `${(import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')}/bling`;
  async function request<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
    if (controller.signal.aborted) throw new DOMException('Conta alterada', 'AbortError');
    const deadline = new AbortController();
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
      deadline.abort(new DOMException('A consulta demorou demais. Tente novamente.', 'TimeoutError'));
    }, timeoutMs);
    const signal = timeoutMs === undefined ? controller.signal : AbortSignal.any([controller.signal, deadline.signal]);
    try {
      const response = await fetch(API_URL + path, { ...init, headers: {
        'Content-Type': 'application/json', 'X-Account-Id': String(accountId),
        Authorization: 'Bearer ' + sessionToken,
      }, signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(response.status === 401 ? 'Sessão expirada. Faça login novamente.' : error.message || 'Não foi possível concluir a operação.');
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  const query = (params: object) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach(item => search.append(key + '[]', String(item)));
      else search.set(key, String(value));
    }
    return '?' + search.toString();
  };
  return {
    getBlingIntegration: () => request<BlingIntegrationStatus>('/integration'),
    getFormasPagamento: () => request<{ data: FormaPagamento[] }>('/formas-pagamentos', {}, 60000),
    saveBlingIntegration: (clientId: string, clientSecret: string, initialOrderNumber?: number | null, paymentMethodId?: string | null) =>
      post<SaveIntegrationResponse>('/integration', { clientId, clientSecret, initialOrderNumber, paymentMethodId }),
    setInitialOrderNumber: (initialOrderNumber: number | null) => post<{ message: string; initialOrderNumber: number | null }>('/integration/initial-order', { initialOrderNumber }),
    getBlingAuthorizationUrl: async () => (await request<AuthorizationUrlResponse>('/authorize')).authorizationUrl,
    deactivateBlingIntegration: () => post('/deactivate'),
    removeBlingIntegration: () => request('/integration', { method: 'DELETE' }),
    getMetaRps: () => request<MetaRpsStatus>('/meta-rps', {}, 10000),
    iniciarMetaRps: (valor: number) => post('/meta-rps', { valor }),
    pausarMetaRps: () => post('/meta-rps/pausar'),
    getPedidosVenda: (params: PedidosVendaParams = {}) => request<PedidosVendaResponse>('/pedidos-venda' + query(params)),
    gerarRPSPedidos: (pedidoIds: number[]) => post<RpsBatchResult>('/gerar-rps', { pedidoIds }),
    getFilaRPS: (params: FilaRpsParams = {}) => request<{ data: RpsRecord[]; total: number }>('/fila-rps' + query(params), {}, 15000),
    getRpsAutomationStatus: () => request<RpsAutomationStatus>('/fila-rps/automacao', {}, 10000),
    setRpsAutomation: (enabled: boolean) => post<{ accountEnabled: boolean }>(`/accounts/${accountId}/automacao`, { enabled }),
    getEstatisticasRPS: () => request<{ pendentes: number; processando: number; emitidos: number; erros: number; valorEmitido: number }>('/fila-rps/estatisticas', {}, 15000),
    enviarNFSeParaPrefeitura: (rpsIds: number[]) => post<RpsBatchResult>('/enviar-nfse', { rpsIds }),
    resetarProcessamentoRps: (id: number) => post<{ status: string; message: string }>(`/fila-rps/${id}/resetar`),
    sincronizarStatusNFSe: () => post<{ verificados: number; atualizados: number; removidos: number; falhas: number }>('/sincronizar-nfse'),
    activate: () => { if (controller.signal.aborted) controller = new AbortController(); },
    dispose: () => controller.abort(),
  };
};
