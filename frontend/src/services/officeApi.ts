const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

function getHeaders(): HeadersInit {
  const token = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Erro na requisição (${response.status})`);
  }
  return response.json();
}

export type LeadStage =
  | 'novo'
  | 'em_atendimento'
  | 'qualificado'
  | 'convertido'
  | 'perdido';

export type LeadSource =
  | 'site'
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'whatsapp'
  | 'indicacao'
  | 'organico';

export interface CrmLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  petName: string | null;
  petSpecies: string | null;
  interest: string | null;
  stage: LeadStage;
  source: LeadSource;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  estimatedValue: number;
  convertedValue: number;
  blingOrderNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmFunnelMetrics {
  totalLeads: number;
  stages: Record<LeadStage, number>;
  conversionRate: number;
  pipelineEstimatedValue: number;
  convertedRevenue: number;
  bySource: {
    source: string;
    total: number;
    convertidos: number;
    revenue: number;
  }[];
  byCampaign: {
    utmCampaign: string;
    total: number;
    convertidos: number;
    revenue: number;
  }[];
}

export type AdPlatform =
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'outros';

export interface AdCampaignMetric {
  id: string;
  platform: AdPlatform;
  campaignName: string;
  utmCampaign: string | null;
  status: 'ativa' | 'pausada' | 'encerrada';
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  notes: string | null;
}

export interface PaidTrafficPerformance {
  totals: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    avgCtr: number;
    avgCpc: number;
    totalPaidLeads: number;
    totalPaidCustomers: number;
    avgCpl: number;
    avgCac: number;
    attributedCrmRevenue: number;
    totalBlingEmitidoRevenue: number;
    crmRoas: number;
    blendedBlingRoas: number;
  };
  byPlatform: {
    platform: string;
    spend: number;
    clicks: number;
    impressions: number;
    leads: number;
    customers: number;
    revenue: number;
    roas: number;
  }[];
  campaigns: {
    campaignKey: string;
    campaignName: string;
    platform: string;
    utmCampaign: string | null;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    crmLeads: number;
    crmConverted: number;
    cpl: number;
    cac: number;
    attributedRevenue: number;
    roas: number;
  }[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface McpInfoResponse {
  serverName: string;
  protocolVersion: string;
  internalDockerUrl: string;
  publicPath: string;
  apiKey: string;
  tools: McpToolDefinition[];
  overview: {
    generatedAt: string;
    erpBling: {
      totals: {
        activeAccounts: number;
        pendentes: number;
        processando: number;
        emitidos: number;
        erros: number;
        totalOrders: number;
        revenueEmitido: number;
        revenueTotal: number;
      };
    };
    crmFunnel: CrmFunnelMetrics;
    paidTraffic: PaidTrafficPerformance['totals'];
  };
}

export const officeApi = {
  // CRM
  listLeads(params?: {
    stage?: string;
    source?: string;
    search?: string;
  }): Promise<CrmLead[]> {
    const qs = new URLSearchParams();
    if (params?.stage) qs.set('stage', params.stage);
    if (params?.source) qs.set('source', params.source);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiRequest<CrmLead[]>(`/crm/leads${suffix}`);
  },
  createLead(data: Partial<CrmLead> & { name: string }): Promise<CrmLead> {
    return apiRequest<CrmLead>('/crm/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateLead(id: string, data: Partial<CrmLead>): Promise<CrmLead> {
    return apiRequest<CrmLead>(`/crm/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteLead(id: string): Promise<{ deleted: boolean }> {
    return apiRequest<{ deleted: boolean }>(`/crm/leads/${id}`, {
      method: 'DELETE',
    });
  },
  getCrmMetrics(): Promise<CrmFunnelMetrics> {
    return apiRequest<CrmFunnelMetrics>('/crm/metrics');
  },

  // Paid Traffic / Ads
  listAdMetrics(): Promise<AdCampaignMetric[]> {
    return apiRequest<AdCampaignMetric[]>('/ads/metrics');
  },
  upsertAdMetric(
    data: Partial<AdCampaignMetric> & {
      platform: AdPlatform;
      campaignName: string;
      spend: number;
    },
  ): Promise<AdCampaignMetric> {
    return apiRequest<AdCampaignMetric>('/ads/metrics', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  deleteAdMetric(id: string): Promise<{ deleted: boolean }> {
    return apiRequest<{ deleted: boolean }>(`/ads/metrics/${id}`, {
      method: 'DELETE',
    });
  },
  getPaidTrafficPerformance(): Promise<PaidTrafficPerformance> {
    return apiRequest<PaidTrafficPerformance>('/ads/performance');
  },

  // MCP Hub (Hermes)
  getMcpInfo(): Promise<McpInfoResponse> {
    return apiRequest<McpInfoResponse>('/mcp/info');
  },
  testMcpTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    return apiRequest<unknown>('/mcp/test-tool', {
      method: 'POST',
      body: JSON.stringify({ name, arguments: args }),
    });
  },
};
