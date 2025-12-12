import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  /**
   * Criar novo registro de RPS
   */
  async criar(data: CreateRpsDto): Promise<PedidoVendaRPS> {
    try {
      const rps = this.rpsRepository.create(data);
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
        where: { pedidoVendaId: String(pedidoId) },
      });
    } catch (error) {
      this.logger.error(`Erro ao buscar RPS por pedido ID ${pedidoId}: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Listar fila de RPS com paginação e filtros
   */
  async listarFila(params: FilaRpsParams): Promise<{ data: PedidoVendaRPS[], total: number }> {
    try {
      const { pagina = 1, limite = 20, status } = params;
      const skip = (pagina - 1) * limite;

      const queryBuilder = this.rpsRepository.createQueryBuilder('rps');

      // Filtrar por status se fornecido
      if (status) {
        queryBuilder.where('rps.status = :status', { status });
      }

      // Ordenar por data de criação (mais recente primeiro)
      queryBuilder.orderBy('rps.createdAt', 'DESC');

      // Paginação
      queryBuilder.skip(skip).take(limite);

      const [data, total] = await queryBuilder.getManyAndCount();

      return { data, total };
    } catch (error) {
      this.logger.error(`Erro ao listar fila de RPS: ${error.message}`, error.stack);
      return { data: [], total: 0 };
    }
  }

  /**
   * Atualizar RPS
   */
  async atualizar(id: number, data: Partial<PedidoVendaRPS>): Promise<PedidoVendaRPS | null> {
    try {
      await this.rpsRepository.update(id, data);
      return await this.rpsRepository.findOne({ where: { id } });
    } catch (error) {
      this.logger.error(`Erro ao atualizar RPS ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Obter estatísticas da fila de RPS
   */
  async obterEstatisticas(): Promise<{ pendentes: number, processando: number, emitidos: number, erros: number }> {
    try {
      const [pendentes, processando, emitidos, erros] = await Promise.all([
        this.rpsRepository.count({ where: { status: 'pendente' } }),
        this.rpsRepository.count({ where: { status: 'processando' } }),
        this.rpsRepository.count({ where: { status: 'emitido' } }),
        this.rpsRepository.count({ where: { status: 'erro' } }),
      ]);

      return { pendentes, processando, emitidos, erros };
    } catch (error) {
      this.logger.error(`Erro ao obter estatísticas: ${error.message}`, error.stack);
      return { pendentes: 0, processando: 0, emitidos: 0, erros: 0 };
    }
  }

  /**
   * Buscar RPS por ID
   */
  async buscarPorId(id: number): Promise<PedidoVendaRPS | null> {
    try {
      return await this.rpsRepository.findOne({ where: { id } });
    } catch (error) {
      this.logger.error(`Erro ao buscar RPS por ID ${id}: ${error.message}`, error.stack);
      return null;
    }
  }
}
