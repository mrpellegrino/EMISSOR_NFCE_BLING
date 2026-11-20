import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdCampaignMetric } from '../entities/ad-campaign-metric.entity';

@Injectable()
export class DeleteAdCampaignMetricUseCase {
  constructor(
    @InjectRepository(AdCampaignMetric)
    private readonly metricRepo: Repository<AdCampaignMetric>,
  ) {}

  async execute(id: string): Promise<{ deleted: boolean }> {
    const res = await this.metricRepo.delete({ id });
    if (!res.affected) {
      throw new NotFoundException(`Registro de campanha ${id} não encontrado`);
    }
    return { deleted: true };
  }
}
