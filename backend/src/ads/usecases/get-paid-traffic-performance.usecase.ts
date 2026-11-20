import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdCampaignMetric } from '../entities/ad-campaign-metric.entity';
import { CrmLead } from '../../crm/entities/crm-lead.entity';
import { PedidoVendaRPS } from '../../bling/entities/pedido-venda-rps.entity';

export interface CampaignPerformanceSummary {
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
}

export interface PaidTrafficPerformanceResult {
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
  campaigns: CampaignPerformanceSummary[];
}

@Injectable()
export class GetPaidTrafficPerformanceUseCase {
  constructor(
    @InjectRepository(AdCampaignMetric)
    private readonly metricRepo: Repository<AdCampaignMetric>,
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepo: Repository<PedidoVendaRPS>,
  ) {}

  async execute(): Promise<PaidTrafficPerformanceResult> {
    const [metrics, leads, rpsRevenueRaw] = await Promise.all([
      this.metricRepo.find({ order: { date: 'DESC' } }),
      this.leadRepo.find(),
      this.rpsRepo
        .createQueryBuilder('rps')
        .select('COALESCE(SUM(rps.valorTotal), 0)', 'total')
        .where('rps.status = :status', { status: 'emitido' })
        .getRawOne<{ total: string }>(),
    ]);

    const totalBlingEmitidoRevenue = Number(
      Number(rpsRevenueRaw?.total ?? 0).toFixed(2),
    );

    const campaignGroup = new Map<
      string,
      {
        campaignName: string;
        platform: string;
        utmCampaign: string | null;
        status: string;
        spend: number;
        impressions: number;
        clicks: number;
      }
    >();

    for (const m of metrics) {
      const key = `${m.platform}::${(m.utmCampaign || m.campaignName).toLowerCase()}`;
      const existing = campaignGroup.get(key) ?? {
        campaignName: m.campaignName,
        platform: m.platform,
        utmCampaign: m.utmCampaign,
        status: m.status,
        spend: 0,
        impressions: 0,
        clicks: 0,
      };
      existing.spend += Number(m.spend ?? 0);
      existing.impressions += Number(m.impressions ?? 0);
      existing.clicks += Number(m.clicks ?? 0);
      campaignGroup.set(key, existing);
    }

    const campaigns: CampaignPerformanceSummary[] = [];

    for (const [key, grp] of campaignGroup.entries()) {
      const matchingLeads = leads.filter((l) => {
        if (grp.utmCampaign && l.utmCampaign) {
          return (
            l.utmCampaign.toLowerCase().trim() ===
            grp.utmCampaign.toLowerCase().trim()
          );
        }
        return false;
      });

      const crmLeads = matchingLeads.length;
      const convertedLeads = matchingLeads.filter(
        (l) => l.stage === 'convertido',
      );
      const crmConverted = convertedLeads.length;
      const attributedRevenue = convertedLeads.reduce((acc, l) => {
        const conv = Number(l.convertedValue ?? 0);
        const est = Number(l.estimatedValue ?? 0);
        return acc + (conv > 0 ? conv : est);
      }, 0);

      const spend = Number(grp.spend.toFixed(2));
      const ctr =
        grp.impressions > 0
          ? Number(((grp.clicks / grp.impressions) * 100).toFixed(2))
          : 0;
      const cpc =
        grp.clicks > 0 ? Number((spend / grp.clicks).toFixed(2)) : 0;
      const cpl = crmLeads > 0 ? Number((spend / crmLeads).toFixed(2)) : 0;
      const cac =
        crmConverted > 0 ? Number((spend / crmConverted).toFixed(2)) : 0;
      const roas =
        spend > 0 ? Number((attributedRevenue / spend).toFixed(2)) : 0;

      campaigns.push({
        campaignKey: key,
        campaignName: grp.campaignName,
        platform: grp.platform,
        utmCampaign: grp.utmCampaign,
        status: grp.status,
        spend,
        impressions: grp.impressions,
        clicks: grp.clicks,
        ctr,
        cpc,
        crmLeads,
        crmConverted,
        cpl,
        cac,
        attributedRevenue: Number(attributedRevenue.toFixed(2)),
        roas,
      });
    }

    const paidSources = new Set(['google_ads', 'meta_ads', 'tiktok_ads']);
    const paidLeads = leads.filter(
      (l) => paidSources.has(l.source) || Boolean(l.utmCampaign || l.gclid || l.fbclid),
    );
    const paidConverted = paidLeads.filter((l) => l.stage === 'convertido');
    const attributedCrmRevenue = Number(
      paidConverted
        .reduce((acc, l) => {
          const conv = Number(l.convertedValue ?? 0);
          const est = Number(l.estimatedValue ?? 0);
          return acc + (conv > 0 ? conv : est);
        }, 0)
        .toFixed(2),
    );

    const totalSpend = Number(
      campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2),
    );
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalPaidLeads = paidLeads.length;
    const totalPaidCustomers = paidConverted.length;

    const avgCtr =
      totalImpressions > 0
        ? Number(((totalClicks / totalImpressions) * 100).toFixed(2))
        : 0;
    const avgCpc =
      totalClicks > 0 ? Number((totalSpend / totalClicks).toFixed(2)) : 0;
    const avgCpl =
      totalPaidLeads > 0 ? Number((totalSpend / totalPaidLeads).toFixed(2)) : 0;
    const avgCac =
      totalPaidCustomers > 0
        ? Number((totalSpend / totalPaidCustomers).toFixed(2))
        : 0;
    const crmRoas =
      totalSpend > 0
        ? Number((attributedCrmRevenue / totalSpend).toFixed(2))
        : 0;
    const blendedBlingRoas =
      totalSpend > 0
        ? Number((totalBlingEmitidoRevenue / totalSpend).toFixed(2))
        : 0;

    const platformMap = new Map<
      string,
      {
        spend: number;
        clicks: number;
        impressions: number;
        leads: number;
        customers: number;
        revenue: number;
      }
    >();

    for (const c of campaigns) {
      const p = platformMap.get(c.platform) ?? {
        spend: 0,
        clicks: 0,
        impressions: 0,
        leads: 0,
        customers: 0,
        revenue: 0,
      };
      p.spend += c.spend;
      p.clicks += c.clicks;
      p.impressions += c.impressions;
      p.leads += c.crmLeads;
      p.customers += c.crmConverted;
      p.revenue += c.attributedRevenue;
      platformMap.set(c.platform, p);
    }

    const byPlatform = Array.from(platformMap.entries()).map(
      ([platform, v]) => ({
        platform,
        spend: Number(v.spend.toFixed(2)),
        clicks: v.clicks,
        impressions: v.impressions,
        leads: v.leads,
        customers: v.customers,
        revenue: Number(v.revenue.toFixed(2)),
        roas: v.spend > 0 ? Number((v.revenue / v.spend).toFixed(2)) : 0,
      }),
    );

    return {
      totals: {
        totalSpend,
        totalImpressions,
        totalClicks,
        avgCtr,
        avgCpc,
        totalPaidLeads,
        totalPaidCustomers,
        avgCpl,
        avgCac,
        attributedCrmRevenue,
        totalBlingEmitidoRevenue,
        crmRoas,
        blendedBlingRoas,
      },
      byPlatform,
      campaigns,
    };
  }
}
