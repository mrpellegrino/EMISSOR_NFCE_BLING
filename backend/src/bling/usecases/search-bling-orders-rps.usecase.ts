import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PedidoVendaRPS } from '../entities/pedido-venda-rps.entity';

export interface SearchBlingOrdersFilter {
  accountId?: number;
  status?: string;
  numeroPedido?: string;
  cliente?: string;
  limit?: number;
}

@Injectable()
export class SearchBlingOrdersRpsUseCase {
  constructor(
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepo: Repository<PedidoVendaRPS>,
  ) {}

  async execute(filter: SearchBlingOrdersFilter = {}) {
    const qb = this.rpsRepo
      .createQueryBuilder('rps')
      .leftJoinAndSelect('rps.account', 'account')
      .orderBy('rps.createdAt', 'DESC')
      .take(Math.min(Math.max(filter.limit ?? 25, 1), 100));

    if (filter.accountId) {
      qb.andWhere('rps.accountId = :accountId', { accountId: filter.accountId });
    }
    if (filter.status) {
      qb.andWhere('rps.status = :status', { status: filter.status });
    }
    if (filter.numeroPedido) {
      qb.andWhere('CAST(rps.numeroPedido AS TEXT) LIKE :numeroPedido', {
        numeroPedido: `%${filter.numeroPedido.trim()}%`,
      });
    }
    if (filter.cliente) {
      qb.andWhere('LOWER(rps.nomeCliente) LIKE LOWER(:cliente)', {
        cliente: `%${filter.cliente.trim()}%`,
      });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      accountId: item.accountId,
      accountName: item.account?.name ?? null,
      pedidoVendaId: item.pedidoVendaId,
      numeroPedido: item.numeroPedido,
      numeroRPS: item.numeroRPS,
      serie: item.serie,
      numeroNFSe: item.numeroNFSe,
      status: item.status,
      valorTotal: Number(item.valorTotal),
      nomeCliente: item.nomeCliente,
      mensagemErro: item.mensagemErro,
      dataEmissao: item.dataEmissao,
      createdAt: item.createdAt,
    }));
  }
}
