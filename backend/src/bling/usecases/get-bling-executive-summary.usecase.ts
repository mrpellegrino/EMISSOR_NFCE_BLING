import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlingIntegration } from '../entities/bling-integration.entity';
import { PedidoVendaRPS } from '../entities/pedido-venda-rps.entity';

export interface AccountExecutiveSummary {
  accountId: number;
  name: string;
  isActive: boolean;
  configured: boolean;
  autoRpsEnabled: boolean;
  initialOrderNumber: number | null;
  rpsTarget: number | null;
  rpsTargetStatus: string | null;
  rpsTargetMessage: string | null;
  counts: {
    pendentes: number;
    processando: number;
    emitidos: number;
    erros: number;
    total: number;
  };
  revenueEmitido: number;
  revenueTotal: number;
}

export interface BlingExecutiveSummaryResult {
  accounts: AccountExecutiveSummary[];
  totals: {
    activeAccounts: number;
    pendentes: number;
    processando: number;
    emitidos: number;
    erros: number;
    totalOrders: number;
    revenueEmitido: number;
    revenueTotal: number;
  };
}

@Injectable()
export class GetBlingExecutiveSummaryUseCase {
  constructor(
    @InjectRepository(BlingIntegration)
    private readonly integrationRepo: Repository<BlingIntegration>,
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepo: Repository<PedidoVendaRPS>,
  ) {}

  async execute(userId?: string): Promise<BlingExecutiveSummaryResult> {
    const where = userId ? { userId } : {};
    const accounts = await this.integrationRepo.find({
      where,
      order: { id: 'ASC' },
    });

    const rawStats = await this.rpsRepo
      .createQueryBuilder('rps')
      .select('rps.accountId', 'accountId')
      .addSelect('rps.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(rps.valorTotal), 0)', 'sumValor')
      .groupBy('rps.accountId')
      .addGroupBy('rps.status')
      .getRawMany<{
        accountId: number | null;
        status: string;
        count: string;
        sumValor: string;
      }>();

    const accountSummaries: AccountExecutiveSummary[] = accounts.map((acc) => {
      const rows = rawStats.filter((r) => Number(r.accountId) === acc.id);
      const getCount = (st: string) =>
        Number(rows.find((r) => r.status === st)?.count ?? 0);
      const getSum = (st: string) =>
        Number(rows.find((r) => r.status === st)?.sumValor ?? 0);

      const pendentes = getCount('pendente');
      const processando = getCount('processando');
      const emitidos = getCount('emitido');
      const erros = getCount('erro');
      const revenueEmitido = Number(getSum('emitido').toFixed(2));
      const revenueTotal = Number(
        rows.reduce((accSum, r) => accSum + Number(r.sumValor ?? 0), 0).toFixed(2),
      );

      return {
        accountId: acc.id,
        name: acc.name,
        isActive: acc.isActive,
        configured: Boolean(acc.clientId && acc.clientSecret),
        autoRpsEnabled: acc.autoRpsEnabled,
        initialOrderNumber: acc.initialOrderNumber,
        rpsTarget: acc.rpsTarget !== null ? Number(acc.rpsTarget) : null,
        rpsTargetStatus: acc.rpsTargetStatus,
        rpsTargetMessage: acc.rpsTargetMessage,
        counts: {
          pendentes,
          processando,
          emitidos,
          erros,
          total: pendentes + processando + emitidos + erros,
        },
        revenueEmitido,
        revenueTotal,
      };
    });

    const totals = accountSummaries.reduce(
      (tot, item) => {
        if (item.isActive) tot.activeAccounts += 1;
        tot.pendentes += item.counts.pendentes;
        tot.processando += item.counts.processando;
        tot.emitidos += item.counts.emitidos;
        tot.erros += item.counts.erros;
        tot.totalOrders += item.counts.total;
        tot.revenueEmitido = Number(
          (tot.revenueEmitido + item.revenueEmitido).toFixed(2),
        );
        tot.revenueTotal = Number(
          (tot.revenueTotal + item.revenueTotal).toFixed(2),
        );
        return tot;
      },
      {
        activeAccounts: 0,
        pendentes: 0,
        processando: 0,
        emitidos: 0,
        erros: 0,
        totalOrders: 0,
        revenueEmitido: 0,
        revenueTotal: 0,
      },
    );

    return { accounts: accountSummaries, totals };
  }
}
