import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';

@Injectable()
export class DeleteLeadUseCase {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
  ) {}

  async execute(id: string): Promise<{ deleted: boolean }> {
    const result = await this.leadRepo.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Lead ${id} não encontrado`);
    }
    return { deleted: true };
  }
}
