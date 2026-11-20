import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdCampaignMetric } from '../entities/ad-campaign-metric.entity';

export interface ListAdMetricsFilter {
  platform?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ListAdCampaignMetricsUseCase {
  constructor(
    @InjectRepository(AdCampaignMetric)
    private readonly metricRepo: Repository<AdCampaignMetric>,
  ) {}

  async execute(filter: ListAdMetricsFilter = {}): Promise<AdCampaignMetric[]> {
    const qb = this.metricRepo
      .createQueryBuilder('m')
      .orderBy('m.date', 'DESC')
      .addOrderBy('m.createdAt', 'DESC');

    if (filter.platform) {
      qb.andWhere('m.platform = :platform', { platform: filter.platform });
    }
    if (filter.status) {
      qb.andWhere('m.status = :status', { status: filter.status });
    }
    if (filter.startDate) {
      qb.andWhere('m.date >= :startDate', { startDate: filter.startDate });
    }
    if (filter.endDate) {
      qb.andWhere('m.date <= :endDate', { endDate: filter.endDate });
    }

    const items = await qb.getMany();
    return items.map((i) => ({
      ...i,
      spend: Number(i.spend ?? 0),
    }));
  }
}
