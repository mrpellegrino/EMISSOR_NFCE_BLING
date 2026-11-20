import { AccountContext } from './account-context';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PedidoVendaRPS } from './entities/pedido-venda-rps.entity';

export interface CreateRpsDto {
  pedidoVendaId: string;
  numeroPedido: string;
  numeroRPS?: string;
  serie?: string;
  nfseId?: string;
  numeroNFSe?: string;
  status: string;
  mensagemErro?: string;
  valorTotal: number;
  nomeCliente: string;
  dataEmissao?: Date;
}

export interface FilaRpsParams {
  pagina?: number;
  limite?: number;
  status?: string;
}

@Injectable()
export class RpsService {
  private readonly logger = new Logger(RpsService.name);

  constructor(
    @InjectRepository(PedidoVendaRPS)
    private readonly rpsRepository: Repository<PedidoVendaRPS>,
    private readonly accountContext: AccountContext,
  ) {}

  async listarParaAutomacao(status: 'pendente' | 'processando', limite = 5) {
    return this.rpsRepository.find({
      where: { accountId: this.accountContext.account.id, status },
      order: status === 'pendente' ? { createdAt: 'ASC', id: 'ASC' } : { updatedAt: 'ASC', id: 'ASC' },
      take: limite,
    });
  }

  // The conditional UPDATE protects manual and automatic dispatches, even in different processes.
  async iniciarEnvio(id: number, status: 'pendente' | 'erro'): Promise<boolean> {
    const result = await this.rpsRepository.update(
      { id, accountId: this.accountContext.account.id, status },
      { status: 'processando', mensagemErro: '' },
    );
    return result.affected === 1;
  }

  async atualizarSeStatus(id: number, status: string, data: Partial<PedidoVendaRPS>): Promise<boolean> {
    const { accountId: ignoredAccountId, account: ignoredAccount, id: ignoredId, ...changes } = data;
    const result = await this.rpsRepository.update({ id, accountId: this.accountContext.account.id, status }, changes);
    return result.affected === 1;
  }

  async removerExcluidoNoBling(rps: PedidoVendaRPS): Promise<boolean> {
    if (!['pendente', 'erro'].includes(rps.status) || rps.numeroNFSe || !rps.nfseId) return false;
    const where = { id: rps.id, accountId: this.accountContext.account.id, status: rps.status, nfseId: rps.nfseId };
    // A concurrent submission or a newly assigned NFSe number must prevent deletion.
    const result = await this.rpsRepository.delete([
      { ...where, numeroNFSe: IsNull() }, { ...where, numeroNFSe: '' },
    ]);
    return result.affected === 1;
  }

  /**
   * Criar novo registro de RPS
   */
  async criar(data: CreateRpsDto): Promise<PedidoVendaRPS> {
    try {
      const rps = this.rpsRepository.create({ ...data, accountId: this.accountContext.account.id });
      return await this.rpsRepository.save(rps);
    } catch (error) {
      this.logger.error(`Erro ao criar RPS: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Buscar RPS por ID do pedido de venda
   */
  async buscarPorPedidoId(pedidoId: string | number): Promise<PedidoVendaRPS | null> {
    try {
      return await this.rpsRepository.findOne({
        where: { pedidoVendaId: String(pedidoId), accountId: this.accountContext.account.id },
      });
    } catch (error) {
      this.logger.error(`Erro ao buscar RPS por pedido ID ${pedidoId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Listar fila de RPS com paginação e filtros
   */
  async listarFila(params: FilaRpsParams): Promise<{ data: PedidoVendaRPS[], total: number }> {
    try {
      const { pagina = 1, limite = 20, status } = params;
      const skip = (pagina - 1) * limite;

      const queryBuilder = this.rpsRepository.createQueryBuilder('rps')
        .where('rps.accountId = :accountId', { accountId: this.accountContext.account.id });

      // Filtrar por status se fornecido
      if (status) {
        queryBuilder.andWhere('rps.status = :status', { status });
      }

      // Ordenar por data de criação (mais recente primeiro)
      queryBuilder.orderBy('rps.createdAt', 'DESC');

      // Paginação
      queryBuilder.skip(skip).take(limite);

      const [data, total] = await queryBuilder.getManyAndCount();

      return { data, total };
    } catch (error) {
      this.logger.error(`Erro ao listar fila de RPS: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Atualizar RPS
   */
  async atualizar(id: number, data: Partial<PedidoVendaRPS>): Promise<PedidoVendaRPS | null> {
    try {
      const { accountId: ignoredAccountId, account: ignoredAccount, id: ignoredId, ...changes } = data;
      await this.rpsRepository.update({ id, accountId: this.accountContext.account.id }, changes);
      return await this.rpsRepository.findOne({ where: { id, accountId: this.accountContext.account.id } });
    } catch (error) {
      this.logger.error(`Erro ao atualizar RPS ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Obter estatísticas da fila de RPS
   */
  async obterValorGerado(): Promise<number> {
    const total = await this.rpsRepository.sum('valorTotal', { accountId: this.accountContext.account.id });
    return Number(total ?? 0);
  }

  async obterIdsPedidosGerados(): Promise<Set<string>> {
    const registros = await this.rpsRepository.find({
      where: { accountId: this.accountContext.account.id }, select: { pedidoVendaId: true },
    });
    return new Set(registros.map(rps => String(rps.pedidoVendaId)));
  }

  async obterEstatisticas(): Promise<{ pendentes: number, processando: number, emitidos: number, erros: number, valorEmitido: number }> {
    try {
      const [pendentes, processando, emitidos, erros, valorEmitido] = await Promise.all([
        this.rpsRepository.count({ where: { accountId: this.accountContext.account.id, status: 'pendente' } }),
        this.rpsRepository.count({ where: { accountId: this.accountContext.account.id, status: 'processando' } }),
        this.rpsRepository.count({ where: { accountId: this.accountContext.account.id, status: 'emitido' } }),
        this.rpsRepository.count({ where: { accountId: this.accountContext.account.id, status: 'erro' } }),
        this.rpsRepository.sum('valorTotal', { accountId: this.accountContext.account.id, status: 'emitido' }),
      ]);

      return { pendentes, processando, emitidos, erros, valorEmitido: Number(valorEmitido ?? 0) };
    } catch (error) {
      this.logger.error(`Erro ao obter estatísticas: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Buscar RPS por ID
   */
  async buscarPorId(id: number): Promise<PedidoVendaRPS | null> {
    try {
      return await this.rpsRepository.findOne({ where: { id, accountId: this.accountContext.account.id } });
    } catch (error) {
      this.logger.error(`Erro ao buscar RPS por ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
