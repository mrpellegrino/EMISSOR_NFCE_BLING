import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLead, LeadSource } from '../entities/crm-lead.entity';
import { CaptureWebsiteLeadDto } from '../dto/crm-lead.dto';

export interface CaptureWebsiteLeadContext {
  clientIp?: string;
  webhookKey?: string;
  isPublicWebhook?: boolean;
  now?: number;
}

const RATE_LIMIT_MAX_REQUESTS = 15;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class CaptureWebsiteLeadUseCase {
  private readonly ipHits = new Map<string, number[]>();

  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
  ) {}

  private normalizeIp(rawIp?: string): string {
    const cleaned = (rawIp || '').trim();
    if (!cleaned) return 'unknown';
    return cleaned.startsWith('::ffff:') ? cleaned.slice(7) : cleaned;
  }

  private assertRateLimit(clientIp: string, now: number): void {
    if (this.ipHits.size > 5000) {
      for (const [key, timestamps] of this.ipHits.entries()) {
        const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (recent.length === 0) {
          this.ipHits.delete(key);
        } else {
          this.ipHits.set(key, recent);
        }
      }
    }

    const ip = this.normalizeIp(clientIp);
    const recent = (this.ipHits.get(ip) ?? []).filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );

    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message:
            'Muitos envios de formulário em pouco tempo. Aguarde alguns minutos e tente novamente.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.ipHits.set(ip, recent);
  }

  private resolveSource(dto: CaptureWebsiteLeadDto): LeadSource {
    const rawSource = (dto.source ?? dto.origem ?? '').toLowerCase().trim();
    if (
      rawSource === 'google_ads' ||
      rawSource === 'meta_ads' ||
      rawSource === 'tiktok_ads' ||
      rawSource === 'whatsapp' ||
      rawSource === 'indicacao' ||
      rawSource === 'organico' ||
      rawSource === 'site'
    ) {
      return rawSource;
    }

    const utmSource = (dto.utmSource ?? dto.utm_source ?? '').toLowerCase();
    if (
      dto.gclid ||
      utmSource.includes('google') ||
      utmSource.includes('adwords')
    ) {
      return 'google_ads';
    }
    if (
      dto.fbclid ||
      utmSource.includes('facebook') ||
      utmSource.includes('instagram') ||
      utmSource.includes('meta') ||
      utmSource.includes('fb') ||
      utmSource.includes('ig')
    ) {
      return 'meta_ads';
    }
    if (utmSource.includes('tiktok')) {
      return 'tiktok_ads';
    }
    if (utmSource.includes('whatsapp') || utmSource.includes('wpp')) {
      return 'whatsapp';
    }
    return 'site';
  }

  async execute(
    dto: CaptureWebsiteLeadDto,
    userId?: string,
    context?: CaptureWebsiteLeadContext,
  ): Promise<CrmLead> {
    if (context?.isPublicWebhook) {
      const configuredKey = (process.env.CRM_WEBHOOK_KEY || '').trim();
      if (configuredKey && context.webhookKey !== configuredKey) {
        throw new UnauthorizedException('Chave do webhook inválida ou ausente');
      }

      if (dto.website?.trim() || dto._hp?.trim()) {
        // Silently discard honeypot bot submission without saving to DB
        return this.leadRepo.create({
          id: 'ignored',
          name: 'ignored',
          stage: 'novo',
          source: 'site',
          estimatedValue: 0,
          convertedValue: 0,
        });
      }

      this.assertRateLimit(context.clientIp || 'unknown', context.now ?? Date.now());
    }

    const resolvedName = (dto.name ?? dto.nome ?? '').trim();
    if (!resolvedName) {
      throw new BadRequestException(
        'O nome do cliente é obrigatório (campo "name" ou "nome").',
      );
    }

    const resolvedPhone =
      (dto.phone ?? dto.telefone ?? dto.whatsapp)?.trim() || null;
    const resolvedPetName =
      (dto.petName ?? dto.nomePet ?? dto.pet)?.trim() || null;
    const resolvedPetSpecies =
      (dto.petSpecies ?? dto.especie ?? dto.tipoPet)?.trim() || null;
    const resolvedInterest =
      (dto.interest ?? dto.interesse ?? dto.servico ?? dto.assunto)?.trim() ||
      null;
    const resolvedLandingPage =
      (dto.landingPage ?? dto.pagina ?? dto.url)?.trim() || null;
    const resolvedNotes =
      (dto.notes ?? dto.mensagem ?? dto.observacoes)?.trim() || null;
    const resolvedEstimatedValue =
      dto.estimatedValue ?? dto.valorEstimado ?? 0;

    const source = this.resolveSource(dto);
    const lead = this.leadRepo.create({
      userId: userId ?? null,
      name: resolvedName,
      phone: resolvedPhone,
      email: dto.email?.trim().toLowerCase() || null,
      petName: resolvedPetName,
      petSpecies: resolvedPetSpecies,
      interest: resolvedInterest,
      stage: 'novo',
      source,
      utmSource: (dto.utmSource ?? dto.utm_source)?.trim() || null,
      utmMedium: (dto.utmMedium ?? dto.utm_medium)?.trim() || null,
      utmCampaign: (dto.utmCampaign ?? dto.utm_campaign)?.trim() || null,
      utmContent: (dto.utmContent ?? dto.utm_content)?.trim() || null,
      utmTerm: (dto.utmTerm ?? dto.utm_term)?.trim() || null,
      gclid: dto.gclid?.trim() || null,
      fbclid: dto.fbclid?.trim() || null,
      landingPage: resolvedLandingPage,
      estimatedValue: Number.isFinite(Number(resolvedEstimatedValue))
        ? Number(resolvedEstimatedValue)
        : 0,
      convertedValue: 0,
      notes: resolvedNotes,
    });

    return this.leadRepo.save(lead);
  }
}
