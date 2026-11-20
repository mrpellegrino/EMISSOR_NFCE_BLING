import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AdPlatform,
  AdCampaignStatus,
} from '../entities/ad-campaign-metric.entity';

const PLATFORMS: AdPlatform[] = [
  'google_ads',
  'meta_ads',
  'tiktok_ads',
  'outros',
];

const STATUSES: AdCampaignStatus[] = ['ativa', 'pausada', 'encerrada'];

export class UpsertAdCampaignMetricDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(PLATFORMS)
  platform: AdPlatform;

  @IsString()
  campaignName: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: AdCampaignStatus;

  @IsOptional()
  @IsString()
  date?: string;

  @Type(() => Number)
  @IsNumber()
  spend: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  impressions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  clicks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  platformConversions?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
