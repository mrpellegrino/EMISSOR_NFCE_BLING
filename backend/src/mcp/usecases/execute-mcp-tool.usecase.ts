import { Injectable, BadRequestException } from '@nestjs/common';
import { GetBlingExecutiveSummaryUseCase } from '../../bling/usecases/get-bling-executive-summary.usecase';
import { SearchBlingOrdersRpsUseCase } from '../../bling/usecases/search-bling-orders-rps.usecase';
import { ListLeadsUseCase } from '../../crm/usecases/list-leads.usecase';
import { CreateLeadUseCase } from '../../crm/usecases/create-lead.usecase';
import { UpdateLeadUseCase } from '../../crm/usecases/update-lead.usecase';
import { GetCrmFunnelMetricsUseCase } from '../../crm/usecases/get-crm-funnel-metrics.usecase';
import { GetPaidTrafficPerformanceUseCase } from '../../ads/usecases/get-paid-traffic-performance.usecase';
import { UpsertAdCampaignMetricUseCase } from '../../ads/usecases/upsert-ad-campaign-metric.usecase';
import type { LeadStage, LeadSource } from '../../crm/entities/crm-lead.entity';
import type {
  AdPlatform,
  AdCampaignStatus,
} from '../../ads/entities/ad-campaign-metric.entity';

@Injectable()
export class ExecuteMcpToolUseCase {
  constructor(
    private readonly getBlingSummaryUseCase: GetBlingExecutiveSummaryUseCase,
    private readonly searchBlingOrdersUseCase: SearchBlingOrdersRpsUseCase,
    private readonly listLeadsUseCase: ListLeadsUseCase,
    private readonly createLeadUseCase: CreateLeadUseCase,
    private readonly updateLeadUseCase: UpdateLeadUseCase,
    private readonly getCrmMetricsUseCase: GetCrmFunnelMetricsUseCase,
    private readonly getAdsPerformanceUseCase: GetPaidTrafficPerformanceUseCase,
    private readonly upsertAdMetricUseCase: UpsertAdCampaignMetricUseCase,
  ) {}

  async execute(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_business_overview': {
        const [bling, crm, ads] = await Promise.all([
          this.getBlingSummaryUseCase.execute(),
          this.getCrmMetricsUseCase.execute(),
          this.getAdsPerformanceUseCase.execute(),
        ]);
        return {
          generatedAt: new Date().toISOString(),
          erpBling: bling,
          crmFunnel: crm,
          paidTraffic: ads.totals,
        };
      }

      case 'list_bling_accounts': {
        const summary = await this.getBlingSummaryUseCase.execute();
        return summary.accounts;
      }

      case 'search_bling_orders_rps': {
        return this.searchBlingOrdersUseCase.execute({
          accountId:
            args.accountId !== undefined ? Number(args.accountId) : undefined,
          status: args.status ? String(args.status) : undefined,
          numeroPedido: args.numeroPedido
            ? String(args.numeroPedido)
            : undefined,
          cliente: args.cliente ? String(args.cliente) : undefined,
          limit: args.limit !== undefined ? Number(args.limit) : 25,
        });
      }

      case 'list_crm_leads': {
        return this.listLeadsUseCase.execute({
          stage: args.stage ? String(args.stage) : undefined,
          source: args.source ? String(args.source) : undefined,
          utmCampaign: args.utmCampaign ? String(args.utmCampaign) : undefined,
          search: args.search ? String(args.search) : undefined,
          limit: args.limit !== undefined ? Number(args.limit) : 50,
        });
      }

      case 'create_crm_lead': {
        if (!args.name) {
          throw new BadRequestException('O campo "name" é obrigatório');
        }
        return this.createLeadUseCase.execute({
          name: String(args.name),
          phone: args.phone ? String(args.phone) : undefined,
          email: args.email ? String(args.email) : undefined,
          petName: args.petName ? String(args.petName) : undefined,
          petSpecies: args.petSpecies ? String(args.petSpecies) : undefined,
          interest: args.interest ? String(args.interest) : undefined,
          source: args.source ? String(args.source) : undefined,
          utmCampaign: args.utmCampaign ? String(args.utmCampaign) : undefined,
          estimatedValue:
            args.estimatedValue !== undefined
              ? Number(args.estimatedValue)
              : undefined,
          notes: args.notes ? String(args.notes) : undefined,
        });
      }

      case 'update_crm_lead': {
        if (!args.id) {
          throw new BadRequestException('O campo "id" é obrigatório');
        }
        return this.updateLeadUseCase.execute(String(args.id), {
          stage: args.stage ? (String(args.stage) as LeadStage) : undefined,
          source: args.source ? (String(args.source) as LeadSource) : undefined,
          convertedValue:
            args.convertedValue !== undefined
              ? Number(args.convertedValue)
              : undefined,
          estimatedValue:
            args.estimatedValue !== undefined
              ? Number(args.estimatedValue)
              : undefined,
          blingOrderNumber:
            args.blingOrderNumber !== undefined
              ? String(args.blingOrderNumber)
              : undefined,
          notes: args.notes !== undefined ? String(args.notes) : undefined,
        });
      }

      case 'get_crm_funnel_metrics': {
        return this.getCrmMetricsUseCase.execute();
      }

      case 'get_paid_traffic_performance': {
        return this.getAdsPerformanceUseCase.execute();
      }

      case 'record_ad_campaign_metric': {
        if (!args.platform || !args.campaignName || args.spend === undefined) {
          throw new BadRequestException(
            'Os campos "platform", "campaignName" e "spend" são obrigatórios',
          );
        }
        return this.upsertAdMetricUseCase.execute({
          platform: String(args.platform) as AdPlatform,
          campaignName: String(args.campaignName),
          utmCampaign: args.utmCampaign ? String(args.utmCampaign) : undefined,
          status: args.status
            ? (String(args.status) as AdCampaignStatus)
            : 'ativa',
          date: args.date ? String(args.date) : undefined,
          spend: Number(args.spend),
          impressions:
            args.impressions !== undefined ? Number(args.impressions) : 0,
          clicks: args.clicks !== undefined ? Number(args.clicks) : 0,
          platformConversions:
            args.platformConversions !== undefined
              ? Number(args.platformConversions)
              : 0,
          notes: args.notes ? String(args.notes) : undefined,
        });
      }

      default:
        throw new BadRequestException(`Tool MCP desconhecida: ${toolName}`);
    }
  }
}
