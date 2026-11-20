import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';

export interface ListLeadsFilter {
  stage?: string;
  source?: string;
  utmCampaign?: string;
  search?: string;
  limit?: number;
}

@Injectable()
export class ListLeadsUseCase {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
  ) {}

  async execute(filter: ListLeadsFilter = {}): Promise<CrmLead[]> {
    const qb = this.leadRepo
      .createQueryBuilder('lead')
      .orderBy('lead.createdAt', 'DESC')
      .take(Math.min(Math.max(filter.limit ?? 100, 1), 300));

    if (filter.stage) {
      qb.andWhere('lead.stage = :stage', { stage: filter.stage });
    }
    if (filter.source) {
      qb.andWhere('lead.source = :source', { source: filter.source });
    }
    if (filter.utmCampaign) {
      qb.andWhere('LOWER(lead.utmCampaign) = LOWER(:utmCampaign)', {
        utmCampaign: filter.utmCampaign.trim(),
      });
    }
    if (filter.search) {
      qb.andWhere(
        '(LOWER(lead.name) LIKE LOWER(:q) OR LOWER(COALESCE(lead.phone, \'\')) LIKE LOWER(:q) OR LOWER(COALESCE(lead.email, \'\')) LIKE LOWER(:q) OR LOWER(COALESCE(lead.petName, \'\')) LIKE LOWER(:q) OR LOWER(COALESCE(lead.interest, \'\')) LIKE LOWER(:q))',
        { q: `%${filter.search.trim()}%` },
      );
    }

    const leads = await qb.getMany();
    return leads.map((l) => ({
      ...l,
      estimatedValue: Number(l.estimatedValue ?? 0),
      convertedValue: Number(l.convertedValue ?? 0),
    }));
  }
}
