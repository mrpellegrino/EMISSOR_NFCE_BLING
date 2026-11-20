import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import type { LeadSource, LeadStage } from '../entities/crm-lead.entity';

const STAGES: LeadStage[] = [
  'novo',
  'em_atendimento',
  'qualificado',
  'convertido',
  'perdido',
];

const SOURCES: LeadSource[] = [
  'site',
  'google_ads',
  'meta_ads',
  'tiktok_ads',
  'whatsapp',
  'indicacao',
  'organico',
];

export class CaptureWebsiteLeadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  petName?: string;

  @IsOptional()
  @IsString()
  nomePet?: string;

  @IsOptional()
  @IsString()
  pet?: string;

  @IsOptional()
  @IsString()
  petSpecies?: string;

  @IsOptional()
  @IsString()
  especie?: string;

  @IsOptional()
  @IsString()
  tipoPet?: string;

  @IsOptional()
  @IsString()
  interest?: string;

  @IsOptional()
  @IsString()
  interesse?: string;

  @IsOptional()
  @IsString()
  servico?: string;

  @IsOptional()
  @IsString()
  assunto?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  origem?: string;

  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utm_medium?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  utm_content?: string;

  @IsOptional()
  @IsString()
  utmContent?: string;

  @IsOptional()
  @IsString()
  utm_term?: string;

  @IsOptional()
  @IsString()
  utmTerm?: string;

  @IsOptional()
  @IsString()
  gclid?: string;

  @IsOptional()
  @IsString()
  fbclid?: string;

  @IsOptional()
  @IsString()
  landingPage?: string;

  @IsOptional()
  @IsString()
  pagina?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valorEstimado?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  mensagem?: string;

  @IsOptional()
  @IsString()
  observacoes?: string;

  // Anti-spam honeypot fields (must remain empty for legitimate humans)
  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  _hp?: string;
}

export class CreateLeadDto extends CaptureWebsiteLeadDto {
  @IsOptional()
  @IsIn(STAGES)
  stage?: LeadStage;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  convertedValue?: number;

  @IsOptional()
  @IsString()
  blingOrderNumber?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  petName?: string;

  @IsOptional()
  @IsString()
  petSpecies?: string;

  @IsOptional()
  @IsString()
  interest?: string;

  @IsOptional()
  @IsIn(STAGES)
  stage?: LeadStage;

  @IsOptional()
  @IsIn(SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  convertedValue?: number;

  @IsOptional()
  @IsString()
  blingOrderNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
