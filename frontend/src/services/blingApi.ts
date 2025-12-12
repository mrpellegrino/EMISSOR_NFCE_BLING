const API_URL = 'http://localhost:3000/api';

// Interface para Pedido de Venda
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

export interface AuthorizationUrlResponse {
  authorizationUrl: string;
}

// Busca o status da integração Bling
export const getBlingIntegration = async (): Promise<BlingIntegrationStatus> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/integration`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Erro ao buscar integração');
  }

  return response.json();
};

// Salva a configuração de integração
export const saveBlingIntegration = async (
  clientId: string,
  clientSecret: string,
  initialOrderNumber?: number | null
): Promise<SaveIntegrationResponse> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/integration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ clientId, clientSecret, initialOrderNumber }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/'; // Redireciona para login
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    const error = await response.json();
    throw new Error(error.message || 'Erro ao salvar configuração');
  }

  return response.json();
};

// Atualiza apenas o número inicial de pedido
export const setInitialOrderNumber = async (initialOrderNumber: number | null): Promise<{ message: string; initialOrderNumber: number | null }> => {
  console.log('🔵 [API] setInitialOrderNumber chamado com:', initialOrderNumber);

  const token = localStorage.getItem('access_token');
  console.log('🔵 [API] Token do localStorage:', token ? `${token.substring(0, 20)}...` : 'null');

  if (!token) {
    console.error('🔴 [API] Token não encontrado no localStorage');
    throw new Error('Você precisa estar logado para realizar esta ação.');
  }

  const url = `${API_URL}/bling/integration/initial-order`;
  const body = { initialOrderNumber };

  console.log('🔵 [API] URL:', url);
  console.log('🔵 [API] Body:', JSON.stringify(body));
  console.log('🔵 [API] Headers:', {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token.substring(0, 20)}...`
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    console.log('🔵 [API] Response status:', response.status);
    console.log('🔵 [API] Response statusText:', response.statusText);
    console.log('🔵 [API] Response ok?', response.ok);

    // Tenta ler o body da resposta
    const responseText = await response.text();
    console.log('🔵 [API] Response body (raw):', responseText);

    if (!response.ok) {
      let errorMessage = 'Erro ao salvar número inicial';

      try {
        const errorData = JSON.parse(responseText);
        console.error('🔴 [API] Erro da API (parsed):', errorData);
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        console.error('🔴 [API] Não foi possível parsear erro:', responseText);
      }

      if (response.status === 401) {
        console.error('🔴 [API] 401 - Token inválido ou expirado');
        errorMessage = 'Sessão expirada. Por favor, faça login novamente.';
        // Não redireciona automaticamente, deixa o componente lidar com isso
      }

      throw new Error(errorMessage);
    }

    const result = JSON.parse(responseText);
    console.log('🟢 [API] Resposta da API (parsed):', result);
    return result;
  } catch (error: any) {
    console.error('🔴 [API] Erro na requisição:', error);
    throw error;
  }
};

// Obtém a URL de autorização OAuth
export const getBlingAuthorizationUrl = async (): Promise<string> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/authorize`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Erro ao obter URL de autorização');
  }

  const data: AuthorizationUrlResponse = await response.json();
  return data.authorizationUrl;
};

// Desativa a integração
export const deactivateBlingIntegration = async (): Promise<void> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/deactivate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Erro ao desativar integração');
  }
};

// Remove a integração
export const removeBlingIntegration = async (): Promise<void> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/integration`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Erro ao remover integração');
  }
};

// Busca dados da empresa no Bling
export const getBlingEmpresa = async () => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/empresa`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Erro ao buscar dados da empresa');
  }

  return response.json();
};

// Lista produtos do Bling
export const getBlingProdutos = async (page = 1, limit = 100) => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(
    `${API_URL}/bling/produtos?page=${page}&limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Erro ao buscar produtos');
  }

  return response.json();
};

// Lista NFC-e do Bling
export const getBlingNfces = async (page = 1, limit = 100) => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(
    `${API_URL}/bling/nfce?page=${page}&limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Erro ao buscar NFC-e');
  }

  return response.json();
};

// Lista contatos do Bling
export const getBlingContatos = async (page = 1, limit = 100) => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(
    `${API_URL}/bling/contatos?page=${page}&limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Erro ao buscar contatos');
  }

  return response.json();
};

// Lista pedidos de venda do Bling
export const getPedidosVenda = async (params: PedidosVendaParams = {}): Promise<PedidosVendaResponse> => {
  const token = localStorage.getItem('access_token');

  const queryParams = new URLSearchParams();
  
  if (params.pagina) queryParams.append('pagina', params.pagina.toString());
  if (params.limite) queryParams.append('limite', params.limite.toString());
  if (params.numero) queryParams.append('numero', params.numero.toString());
  if (params.dataInicial) queryParams.append('dataInicial', params.dataInicial);
  if (params.dataFinal) queryParams.append('dataFinal', params.dataFinal);
  if (params.idContato) queryParams.append('idContato', params.idContato.toString());
  if (params.idsSituacoes && params.idsSituacoes.length > 0) {
    params.idsSituacoes.forEach(id => queryParams.append('idsSituacoes[]', id.toString()));
  }

  const url = `${API_URL}/bling/pedidos-venda${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao buscar pedidos de venda' }));
    throw new Error(error.message || 'Erro ao buscar pedidos de venda');
  }

  return response.json();
};

/**
 * =====================================================
 * FUNÇÕES PARA RPS
 * =====================================================
 */

/**
 * Gerar RPS para pedidos de venda selecionados
 */
export const gerarRPSPedidos = async (pedidoIds: number[]): Promise<any> => {
  const token = localStorage.getItem('access_token');
  const url = `${API_URL}/bling/gerar-rps`;
  const body = { pedidoIds };

  console.log('🔵 [gerarRPSPedidos] URL:', url);
  console.log('🔵 [gerarRPSPedidos] Request Body:', JSON.stringify(body, null, 2));
  console.log('🔵 [gerarRPSPedidos] Token:', token ? `${token.substring(0, 30)}...` : 'NULO');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  console.log('🔵 [gerarRPSPedidos] Response Status:', response.status);
  console.log('🔵 [gerarRPSPedidos] Response OK:', response.ok);

  const responseText = await response.text();
  console.log('🔵 [gerarRPSPedidos] Response Body (raw):', responseText);

  if (!response.ok) {
    let errorData;
    try {
      errorData = JSON.parse(responseText);
    } catch {
      errorData = { message: 'Erro ao gerar RPS' };
    }
    console.error('🔴 [gerarRPSPedidos] Erro:', errorData);
    throw new Error(errorData.message || 'Erro ao gerar RPS');
  }

  const result = JSON.parse(responseText);
  console.log('🟢 [gerarRPSPedidos] Response Data:', JSON.stringify(result, null, 2));
  return result;
};

/**
 * Interface para parâmetros da fila RPS
 */
export interface FilaRpsParams {
  pagina?: number;
  limite?: number;
  status?: string;
}

/**
 * Buscar fila de RPS
 */
export const getFilaRPS = async (params: FilaRpsParams = {}): Promise<any> => {
  const token = localStorage.getItem('access_token');

  const queryParams = new URLSearchParams();
  if (params.pagina) queryParams.append('pagina', params.pagina.toString());
  if (params.limite) queryParams.append('limite', params.limite.toString());
  if (params.status) queryParams.append('status', params.status);

  const url = `${API_URL}/bling/fila-rps${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao carregar fila RPS' }));
    throw new Error(error.message || 'Erro ao carregar fila RPS');
  }

  return response.json();
};

/**
 * Obter estatísticas da fila RPS
 */
export const getEstatisticasRPS = async (): Promise<any> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/fila-rps/estatisticas`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao buscar estatísticas' }));
    throw new Error(error.message || 'Erro ao buscar estatísticas');
  }

  return response.json();
};

/**
 * Enviar NFSe selecionadas para a prefeitura
 */
export const enviarNFSeParaPrefeitura = async (rpsIds: number[]): Promise<any> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/enviar-nfse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rpsIds }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao enviar NFSe' }));
    throw new Error(error.message || 'Erro ao enviar NFSe');
  }

  return response.json();
};

/**
 * Sincronizar status das NFSe com o Bling
 */
export const sincronizarStatusNFSe = async (): Promise<any> => {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_URL}/bling/sincronizar-nfse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao sincronizar' }));
    throw new Error(error.message || 'Erro ao sincronizar');
  }

  return response.json();
};
