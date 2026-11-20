import {
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { CrmLead } from '../entities/crm-lead.entity';
import { CaptureWebsiteLeadUseCase } from './capture-website-lead.usecase';

function createMockRepo() {
  return {
    create: jest.fn((data: Partial<CrmLead>) => ({
      id: data.id ?? 'lead-uuid-1',
      ...data,
    })),
    save: jest.fn(async (entity: CrmLead) => entity),
  } as unknown as Repository<CrmLead> & {
    create: jest.Mock;
    save: jest.Mock;
  };
}

describe('CaptureWebsiteLeadUseCase', () => {
  it('accepts Portuguese form fields and auto-detects google_ads from gclid', async () => {
    const repo = createMockRepo();
    const useCase = new CaptureWebsiteLeadUseCase(repo);

    const lead = await useCase.execute(
      {
        nome: 'Ana Paula',
        whatsapp: '11988887777',
        email: 'ANA@EXEMPLO.COM',
        nomePet: 'Mel',
        especie: 'cachorro',
        servico: 'Banho e Tosa',
        mensagem: 'Quero agendar para sábado',
        pagina: 'https://vilapetbrasil.com.br/banho-e-tosa',
        gclid: 'EAIaIQobChMI12345',
        utm_campaign: 'banho-tosa-search',
        valorEstimado: 150,
      },
      undefined,
      { isPublicWebhook: true, clientIp: '198.51.100.1', now: 1_700_000_000_000 },
    );

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(lead.name).toBe('Ana Paula');
    expect(lead.phone).toBe('11988887777');
    expect(lead.email).toBe('ana@exemplo.com');
    expect(lead.petName).toBe('Mel');
    expect(lead.petSpecies).toBe('cachorro');
    expect(lead.interest).toBe('Banho e Tosa');
    expect(lead.notes).toBe('Quero agendar para sábado');
    expect(lead.source).toBe('google_ads');
    expect(lead.utmCampaign).toBe('banho-tosa-search');
    expect(lead.estimatedValue).toBe(150);
  });

  it('auto-detects meta_ads from fbclid', async () => {
    const repo = createMockRepo();
    const useCase = new CaptureWebsiteLeadUseCase(repo);

    const lead = await useCase.execute(
      { name: 'Carlos', fbclid: 'IwAR123' },
      undefined,
      { isPublicWebhook: true, clientIp: '198.51.100.2', now: 1_700_000_000_000 },
    );

    expect(lead.source).toBe('meta_ads');
  });

  it('silently ignores honeypot bot submissions without saving to DB', async () => {
    const repo = createMockRepo();
    const useCase = new CaptureWebsiteLeadUseCase(repo);

    const result = await useCase.execute(
      { nome: 'Spam Bot', website: 'http://spam.example' },
      undefined,
      { isPublicWebhook: true, clientIp: '198.51.100.3', now: 1_700_000_000_000 },
    );

    expect(result.id).toBe('ignored');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('throws 400 when neither name nor nome is provided', async () => {
    const repo = createMockRepo();
    const useCase = new CaptureWebsiteLeadUseCase(repo);

    await expect(
      useCase.execute({ telefone: '11999990000' }, undefined, {
        isPublicWebhook: true,
        clientIp: '198.51.100.4',
        now: 1_700_000_000_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rate-limits public submissions after 15 requests per IP in 10 minutes', async () => {
    const repo = createMockRepo();
    const useCase = new CaptureWebsiteLeadUseCase(repo);
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < 15; i++) {
      await useCase.execute({ nome: `Lead ${i}` }, undefined, {
        isPublicWebhook: true,
        clientIp: '198.51.100.55',
        now: t0 + i * 1000,
      });
    }

    try {
      await useCase.execute({ nome: 'Lead 16' }, undefined, {
        isPublicWebhook: true,
        clientIp: '198.51.100.55',
        now: t0 + 20_000,
      });
      fail('Expected 429 rate limit');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
