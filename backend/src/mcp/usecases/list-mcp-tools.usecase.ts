import { Injectable } from '@nestjs/common';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

@Injectable()
export class ListMcpToolsUseCase {
  execute(): McpToolDefinition[] {
    return [
      {
        name: 'get_business_overview',
        description:
          'Retorna o panorama executivo consolidado da Vila Pet: faturamento e fila de NFSe/RPS no Bling ERP, funil de leads do CRM e performance/ROAS de tráfego pago.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_bling_accounts',
        description:
          'Lista todas as contas/CNPJs do Bling ERP conectadas no Vila Pet Office, incluindo metas de RPS, status do emissor automático e faturamento emitido.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'search_bling_orders_rps',
        description:
          'Busca pedidos de venda / RPS sincronizados do Bling ERP por conta, status (pendente, processando, emitido, erro), número do pedido ou nome do cliente.',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: {
              type: 'number',
              description: 'ID da conta do Bling (opcional)',
            },
            status: {
              type: 'string',
              enum: ['pendente', 'processando', 'emitido', 'erro'],
              description: 'Status do RPS/NFSe (opcional)',
            },
            numeroPedido: {
              type: 'string',
              description: 'Número do pedido no Bling (opcional)',
            },
            cliente: {
              type: 'string',
              description: 'Nome parcial do cliente (opcional)',
            },
            limit: {
              type: 'number',
              description: 'Limite de registros (padrão 25, máx 100)',
            },
          },
        },
      },
      {
        name: 'list_crm_leads',
        description:
          'Lista e filtra leads do CRM da Vila Pet (capturados do site, WhatsApp ou campanhas de tráfego pago).',
        inputSchema: {
          type: 'object',
          properties: {
            stage: {
              type: 'string',
              enum: [
                'novo',
                'em_atendimento',
                'qualificado',
                'convertido',
                'perdido',
              ],
              description: 'Estágio do funil (opcional)',
            },
            source: {
              type: 'string',
              enum: [
                'site',
                'google_ads',
                'meta_ads',
                'tiktok_ads',
                'whatsapp',
                'indicacao',
                'organico',
              ],
              description: 'Origem do lead (opcional)',
            },
            utmCampaign: {
              type: 'string',
              description: 'Nome da campanha UTM (opcional)',
            },
            search: {
              type: 'string',
              description:
                'Busca por nome do cliente, telefone, e-mail, pet ou interesse (opcional)',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima de leads retornados (padrão 50)',
            },
          },
        },
      },
      {
        name: 'create_crm_lead',
        description:
          'Cadastra um novo lead no CRM da Vila Pet com dados do tutor, pet, interesse e rastreamento de campanha (UTM).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome do cliente/tutor' },
            phone: { type: 'string', description: 'Telefone / WhatsApp' },
            email: { type: 'string', description: 'E-mail do cliente' },
            petName: { type: 'string', description: 'Nome do pet' },
            petSpecies: {
              type: 'string',
              description: 'Espécie do pet (cachorro, gato, outro)',
            },
            interest: {
              type: 'string',
              description:
                'Produto ou serviço de interesse (ex: Banho e Tosa, Ração, Consulta)',
            },
            source: {
              type: 'string',
              description:
                'Origem (site, google_ads, meta_ads, whatsapp, indicacao, organico)',
            },
            utmCampaign: {
              type: 'string',
              description: 'Campanha UTM associada',
            },
            estimatedValue: {
              type: 'number',
              description: 'Valor estimado da oportunidade em R$',
            },
            notes: { type: 'string', description: 'Observações do atendimento' },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_crm_lead',
        description:
          'Atualiza estágio do funil, valores, observações ou vincula um pedido do Bling ERP (blingOrderNumber) a um lead existente no CRM.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'UUID do lead no CRM' },
            stage: {
              type: 'string',
              enum: [
                'novo',
                'em_atendimento',
                'qualificado',
                'convertido',
                'perdido',
              ],
              description: 'Novo estágio do lead no funil',
            },
            convertedValue: {
              type: 'number',
              description: 'Valor convertido da venda em R$',
            },
            blingOrderNumber: {
              type: 'string',
              description:
                'Número do pedido no Bling ERP para vincular automaticamente ao lead',
            },
            notes: {
              type: 'string',
              description: 'Observações atualizadas sobre o lead',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_crm_funnel_metrics',
        description:
          'Retorna métricas consolidadas do funil de vendas do CRM: total de leads por etapa, taxa de conversão, pipeline estimado e receita por origem/campanha.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_paid_traffic_performance',
        description:
          'Retorna a performance de Tráfego Pago (Google Ads, Meta Ads, etc.) cruzada com os leads do CRM e o faturamento real do Bling ERP (CTR, CPC, CPL, CAC e ROAS).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'record_ad_campaign_metric',
        description:
          'Registra ou atualiza métricas de investimento (spend, impressões, cliques) de uma campanha de tráfego pago.',
        inputSchema: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              enum: ['google_ads', 'meta_ads', 'tiktok_ads', 'outros'],
              description: 'Plataforma de anúncios',
            },
            campaignName: {
              type: 'string',
              description: 'Nome da campanha',
            },
            utmCampaign: {
              type: 'string',
              description:
                'Tag utm_campaign para cruzamento automático com os leads do site',
            },
            date: {
              type: 'string',
              description: 'Data de referência no formato YYYY-MM-DD',
            },
            spend: {
              type: 'number',
              description: 'Valor investido em R$',
            },
            impressions: {
              type: 'number',
              description: 'Total de impressões',
            },
            clicks: {
              type: 'number',
              description: 'Total de cliques',
            },
          },
          required: ['platform', 'campaignName', 'spend'],
        },
      },
    ];
  }
}
