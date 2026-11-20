import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';
import { UpdateLeadDto } from '../dto/crm-lead.dto';
import { PedidoVendaRPS } from '../../bling/entities/pedido-venda-rps.entity';

@Injectable()
export class UpdateLeadUseCase {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepo: Repository<PedidoVendaRPS>,
  ) {}

  async execute(id: string, dto: UpdateLeadDto): Promise<CrmLead> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} não encontrado`);
    }

    if (dto.name !== undefined) lead.name = dto.name.trim();
    if (dto.phone !== undefined) lead.phone = dto.phone?.trim() || null;
    if (dto.email !== undefined)
      lead.email = dto.email?.trim().toLowerCase() || null;
    if (dto.petName !== undefined) lead.petName = dto.petName?.trim() || null;
    if (dto.petSpecies !== undefined)
      lead.petSpecies = dto.petSpecies?.trim() || null;
    if (dto.interest !== undefined) lead.interest = dto.interest?.trim() || null;
    if (dto.stage !== undefined) lead.stage = dto.stage;
    if (dto.source !== undefined) lead.source = dto.source;
    if (dto.utmSource !== undefined)
      lead.utmSource = dto.utmSource?.trim() || null;
    if (dto.utmMedium !== undefined)
      lead.utmMedium = dto.utmMedium?.trim() || null;
    if (dto.utmCampaign !== undefined)
      lead.utmCampaign = dto.utmCampaign?.trim() || null;
    if (dto.estimatedValue !== undefined)
      lead.estimatedValue = dto.estimatedValue;
    if (dto.convertedValue !== undefined)
      lead.convertedValue = dto.convertedValue;
    if (dto.notes !== undefined) lead.notes = dto.notes?.trim() || null;

    if (dto.blingOrderNumber !== undefined) {
      const trimmedOrder = dto.blingOrderNumber?.trim() || null;
      lead.blingOrderNumber = trimmedOrder;
      if (trimmedOrder) {
        const order = await this.rpsRepo.findOne({
          where: { numeroPedido: trimmedOrder },
        });
        if (order && dto.convertedValue === undefined && Number(lead.convertedValue) === 0) {
          lead.convertedValue = Number(order.valorTotal);
        }
        if (dto.stage === undefined && lead.stage !== 'convertido') {
          lead.stage = 'convertido';
        }
      }
    }

    const saved = await this.leadRepo.save(lead);
    return {
      ...saved,
      estimatedValue: Number(saved.estimatedValue ?? 0),
      convertedValue: Number(saved.convertedValue ?? 0),
    };
  }
}
