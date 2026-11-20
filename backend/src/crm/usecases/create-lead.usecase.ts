import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';
import { CreateLeadDto } from '../dto/crm-lead.dto';
import { CaptureWebsiteLeadUseCase } from './capture-website-lead.usecase';
import { PedidoVendaRPS } from '../../bling/entities/pedido-venda-rps.entity';

@Injectable()
export class CreateLeadUseCase {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepo: Repository<PedidoVendaRPS>,
    private readonly captureWebsiteLeadUseCase: CaptureWebsiteLeadUseCase,
  ) {}

  async execute(dto: CreateLeadDto, userId?: string): Promise<CrmLead> {
    const baseLead = await this.captureWebsiteLeadUseCase.execute(dto, userId);

    let convertedValue = dto.convertedValue ?? 0;
    let stage = dto.stage ?? baseLead.stage;

    if (dto.blingOrderNumber) {
      const order = await this.rpsRepo.findOne({
        where: { numeroPedido: dto.blingOrderNumber.trim() },
      });
      if (order && !dto.convertedValue) {
        convertedValue = Number(order.valorTotal);
      }
      if (!dto.stage) {
        stage = 'convertido';
      }
    }

    baseLead.stage = stage;
    baseLead.convertedValue = convertedValue;
    baseLead.blingOrderNumber = dto.blingOrderNumber?.trim() || null;

    return this.leadRepo.save(baseLead);
  }
}
