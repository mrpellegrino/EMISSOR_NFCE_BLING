import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bling_integrations')
export class BlingIntegration {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: string;

  @Column({ default: 'Minha conta', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  clientId: string | null;

  @Column({ type: 'text', nullable: true })
  clientSecret: string | null;

  @Column({ default: '050801' })
  serviceCode: string;

  @Column({ type: 'int', nullable: true })
  installment: number | null;

  @Column({ type: 'bigint', nullable: true })
  paymentMethodId: string | null;

  @Column({ default: true })
  autoRpsEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  oauthStateHash: string | null;

  @Column({ type: 'bigint', nullable: true })
  oauthStateExpiresAt: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  rpsTarget: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  rpsTargetStatus: string | null;

  @Column({ type: 'text', nullable: true })
  rpsTargetMessage: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  rpsTargetFailures: { pedidoId: number; numeroPedido: string; mensagem: string; at: string }[];

  @Column({ default: false })
  legacyImported: boolean;

  @Column({ type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'bigint', nullable: true })
  expiresAt: number | null;

  @Column({ default: false })
  isActive: boolean;

  @Column({ type: 'int', nullable: true })
  initialOrderNumber: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
