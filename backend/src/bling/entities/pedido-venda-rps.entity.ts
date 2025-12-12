import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('pedidos_venda_rps')
export class PedidoVendaRPS {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', unique: true })
  pedidoVendaId: string; // ID do pedido no Bling

  @Column({ type: 'bigint' })
  numeroPedido: string; // Número do pedido

  @Column({ nullable: true })
  numeroRPS: string; // Número do RPS retornado pelo Bling

  @Column({ nullable: true })
  serie: string; // Série do RPS

  @Column({ type: 'bigint', nullable: true })
  nfseId: string; // ID da NFSe no Bling

  @Column({ nullable: true })
  numeroNFSe: string; // Número da NFSe (após processamento)

  @Column({ type: 'varchar', length: 50 })
  status: string; // pendente, processando, emitido, erro

  @Column({ type: 'text', nullable: true })
  mensagemErro: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  valorTotal: number;

  @Column()
  nomeCliente: string;

  @Column({ type: 'timestamp', nullable: true })
  dataEmissao: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
