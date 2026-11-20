import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type LeadStage =
  | 'novo'
  | 'em_atendimento'
  | 'qualificado'
  | 'convertido'
  | 'perdido';

export type LeadSource =
  | 'site'
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'whatsapp'
  | 'indicacao'
  | 'organico';

@Entity('crm_leads')
@Index('IDX_crm_leads_stage', ['stage'])
@Index('IDX_crm_leads_source', ['source'])
@Index('IDX_crm_leads_utm_campaign', ['utmCampaign'])
export class CrmLead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  petName: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  petSpecies: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  interest: string | null;

  @Column({ type: 'varchar', length: 30, default: 'novo' })
  stage: LeadStage;

  @Column({ type: 'varchar', length: 40, default: 'site' })
  source: LeadSource;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  utmCampaign: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  utmContent: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  utmTerm: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  gclid: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  fbclid: string | null;

  @Column({ type: 'text', nullable: true })
  landingPage: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  estimatedValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  convertedValue: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  blingOrderNumber: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
