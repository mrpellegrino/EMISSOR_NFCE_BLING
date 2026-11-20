import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';

export interface CrmFunnelMetrics {
  totalLeads: number;
  stages: {
    novo: number;
    em_atendimento: number;
    qualificado: number;
    convertido: number;
    perdido: number;
  };
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

@Injectable()
export class GetCrmFunnelMetricsUseCase {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
  ) {}

  async execute(): Promise<CrmFunnelMetrics> {
    const leads = await this.leadRepo.find();

    const stages = {
      novo: 0,
      em_atendimento: 0,
      qualificado: 0,
      convertido: 0,
      perdido: 0,
    };

    let pipelineEstimatedValue = 0;
    let convertedRevenue = 0;

    const sourceMap = new Map<
      string,
      { total: number; convertidos: number; revenue: number }
    >();
    const campaignMap = new Map<
      string,
      { total: number; convertidos: number; revenue: number }
    >();

    for (const lead of leads) {
      if (lead.stage in stages) {
        stages[lead.stage] += 1;
      }
      const est = Number(lead.estimatedValue ?? 0);
      const conv = Number(lead.convertedValue ?? 0);

      if (lead.stage !== 'perdido') {
        pipelineEstimatedValue += est;
      }
      if (lead.stage === 'convertido') {
        convertedRevenue += conv > 0 ? conv : est;
      }

      const src = lead.source || 'site';
      const srcEntry = sourceMap.get(src) ?? {
        total: 0,
        convertidos: 0,
        revenue: 0,
      };
      srcEntry.total += 1;
      if (lead.stage === 'convertido') {
        srcEntry.convertidos += 1;
        srcEntry.revenue += conv > 0 ? conv : est;
      }
      sourceMap.set(src, srcEntry);

      if (lead.utmCampaign) {
        const cmp = lead.utmCampaign;
        const cmpEntry = campaignMap.get(cmp) ?? {
          total: 0,
          convertidos: 0,
          revenue: 0,
        };
        cmpEntry.total += 1;
        if (lead.stage === 'convertido') {
          cmpEntry.convertidos += 1;
          cmpEntry.revenue += conv > 0 ? conv : est;
        }
        campaignMap.set(cmp, cmpEntry);
      }
    }

    const totalLeads = leads.length;
    const conversionRate =
      totalLeads > 0
        ? Number(((stages.convertido / totalLeads) * 100).toFixed(2))
        : 0;

    return {
      totalLeads,
      stages,
      conversionRate,
      pipelineEstimatedValue: Number(pipelineEstimatedValue.toFixed(2)),
      convertedRevenue: Number(convertedRevenue.toFixed(2)),
      bySource: Array.from(sourceMap.entries())
        .map(([source, v]) => ({
          source,
          total: v.total,
          convertidos: v.convertidos,
          revenue: Number(v.revenue.toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total),
      byCampaign: Array.from(campaignMap.entries())
        .map(([utmCampaign, v]) => ({
          utmCampaign,
          total: v.total,
          convertidos: v.convertidos,
          revenue: Number(v.revenue.toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
