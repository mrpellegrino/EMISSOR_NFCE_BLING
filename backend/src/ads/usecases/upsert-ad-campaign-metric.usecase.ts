import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdCampaignMetric } from '../entities/ad-campaign-metric.entity';
import { UpsertAdCampaignMetricDto } from '../dto/ad-campaign-metric.dto';

@Injectable()
export class UpsertAdCampaignMetricUseCase {
  constructor(
    @InjectRepository(AdCampaignMetric)
    private readonly metricRepo: Repository<AdCampaignMetric>,
  ) {}

  async execute(
    dto: UpsertAdCampaignMetricDto,
    userId?: string,
  ): Promise<AdCampaignMetric> {
    const today = new Date().toISOString().slice(0, 10);
    const date = dto.date?.trim() || today;

    let entity: AdCampaignMetric | null = null;
    if (dto.id) {
      entity = await this.metricRepo.findOne({ where: { id: dto.id } });
    }

    if (!entity) {
      entity = this.metricRepo.create({
        userId: userId ?? null,
        platform: dto.platform,
        campaignName: dto.campaignName.trim(),
        utmCampaign: dto.utmCampaign?.trim() || null,
        status: dto.status ?? 'ativa',
        date,
        spend: dto.spend ?? 0,
        impressions: dto.impressions ?? 0,
        clicks: dto.clicks ?? 0,
        platformConversions: dto.platformConversions ?? 0,
        notes: dto.notes?.trim() || null,
      });
    } else {
      entity.platform = dto.platform;
      entity.campaignName = dto.campaignName.trim();
      entity.utmCampaign = dto.utmCampaign?.trim() || null;
      if (dto.status) entity.status = dto.status;
      entity.date = date;
      entity.spend = dto.spend ?? entity.spend;
      if (dto.impressions !== undefined) entity.impressions = dto.impressions;
      if (dto.clicks !== undefined) entity.clicks = dto.clicks;
      if (dto.platformConversions !== undefined)
        entity.platformConversions = dto.platformConversions;
      if (dto.notes !== undefined) entity.notes = dto.notes?.trim() || null;
    }

    const saved = await this.metricRepo.save(entity);
    return {
      ...saved,
      spend: Number(saved.spend ?? 0),
    };
  }
}
