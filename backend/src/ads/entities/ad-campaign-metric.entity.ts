import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type AdPlatform =
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'outros';

export type AdCampaignStatus = 'ativa' | 'pausada' | 'encerrada';

@Entity('ad_campaign_metrics')
@Index('IDX_ad_metrics_platform_date', ['platform', 'date'])
@Index('IDX_ad_metrics_utm_campaign', ['utmCampaign'])
export class AdCampaignMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 30, default: 'google_ads' })
  platform: AdPlatform;

  @Column({ length: 160 })
  campaignName: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  utmCampaign: string | null;

  @Column({ type: 'varchar', length: 25, default: 'ativa' })
  status: AdCampaignStatus;

  @Column({ type: 'varchar', length: 10 })
  date: string; // YYYY-MM-DD

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  spend: number;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ type: 'int', default: 0 })
  platformConversions: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
