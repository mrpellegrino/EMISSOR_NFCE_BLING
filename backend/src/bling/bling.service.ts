import { RpsTargetProgress, novoProgressoMeta } from './rps-target-progress';
import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { AccountContext } from './account-context';
import { BlingIntegration } from './entities/bling-integration.entity';
import { RpsService } from './rps.service';
import * as crypto from 'crypto';

interface BlingTokens {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token: string;
  expires_at?: number; // Timestamp de expiração calculado
}

export class BlingApiException extends BadRequestException {
  constructor(readonly upstreamStatus: number, message: string, readonly upstreamType?: string) { super(message); }
}

export interface NFSeResultado {
  duplicata: string | null;
  status: 'sucesso' | 'parcial' | 'erro' | 'emitida' | 'verificado' | 'pendente';
  nfseId?: number;
  numero?: string | null;
  rps?: string | null;
  idNota?: string | null;
  dataEmissao?: string | null;
  enviada?: boolean;
  mensagem: string;
}

interface BlingConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  base_url: string;

  authorization_url: string;
  token_url: string;
  initial_order_number?: number | null;
}

@Injectable()
export class BlingService {
  private readonly logger = new Logger(BlingService.name);
  private static readonly BLING_REQUEST_INTERVAL_MS = 500; // Limite da API: 3 req/s (com margem)
  private get config(): BlingConfig {
    const account = this.accountContext.account;
    return {
      client_id: account.clientId || '', client_secret: account.clientSecret || '',
      redirect_uri: this.configService.get('BLING_REDIRECT_URI', 'http://localhost:3000/api/bling/callback'),
      base_url: this.configService.get('BLING_API_BASE_URL', 'https://api.bling.com.br'),
      authorization_url: this.configService.get('BLING_AUTHORIZATION_URL', 'https://www.bling.com.br/Api/v3/oauth/authorize'),
      token_url: this.configService.get('BLING_TOKEN_URL', 'https://www.bling.com.br/Api/v3/oauth/token'),
      initial_order_number: account.initialOrderNumber,
    };
  }
  private get tokens(): BlingTokens | null {
    const account = this.accountContext.account;
    if (!account.accessToken) return null;
    return { access_token: account.accessToken, refresh_token: account.refreshToken || '',
      expires_at: Number(account.expiresAt), expires_in: 0, token_type: 'Bearer', scope: '' };
  }
  private set tokens(tokens: BlingTokens | null) {
    Object.assign(this.accountContext.account, {
      accessToken: tokens?.access_token ?? null, refreshToken: tokens?.refresh_token ?? null,
      expiresAt: tokens?.expires_at ?? null, isActive: !!tokens,
    });
  }
  private persistAccount() {
    // Automation can be paused concurrently; never overwrite that flag from a stale token snapshot.
    const { autoRpsEnabled, rpsTarget, rpsTargetStatus, rpsTargetMessage, rpsTargetFailures, ...account } = this.accountContext.account;
    return this.blingIntegrationRepository.save(account);
  }

  private async envioAutomaticoHabilitado(): Promise<boolean> {
    const account = await this.blingIntegrationRepository.findOne({
      where: { id: this.accountContext.account.id }, select: { id: true, autoRpsEnabled: true },
    });
    return !!account && account.autoRpsEnabled !== false;
  }
  private lastBlingRequestAt = 0;
  private blingRateLimitChain: Promise<void> = Promise.resolve();

  // Códigos de serviços disponíveis
  private readonly codigosServico = {
    '050801': {
      codigo: '050801',
      descricao: 'Serviços de Estética Animal (banho e tosa)',
      tipo: 'ESTETICA_ANIMAL'
    }
  };

  // Código de serviço padrão (pode ser alterado via configuração)
  private get codigoServicoAtual() { return this.accountContext.account.serviceCode; }

  // Parcela atual (pode ser alterada via configuração)
  private get parcelaAtual() { return this.accountContext.account.installment ?? new Date().getMonth() + 1; }

  constructor(
    private configService: ConfigService,
    @InjectRepository(BlingIntegration)
    private readonly blingIntegrationRepository: Repository<BlingIntegration>,
    @Inject(forwardRef(() => RpsService)) private readonly rpsService: RpsService,
    private readonly accountContext: AccountContext,
  ) {}

  private dataEmissaoHoje(): string {
    // UTC já está no dia seguinte após as 21h em Brasília (rejeição E0008).
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForBlingRateLimit(): Promise<void> {
    const limiter = async () => {
      const elapsed = Date.now() - this.lastBlingRequestAt;
      const waitMs = BlingService.BLING_REQUEST_INTERVAL_MS - elapsed;

      if (waitMs > 0) {
        await this.sleep(waitMs);
      }

      this.lastBlingRequestAt = Date.now();
    };

    this.blingRateLimitChain = this.blingRateLimitChain.then(limiter, limiter);
    await this.blingRateLimitChain;
  }

  getIntegrationStatus() {
    const account = this.accountContext.account;
    return {
      accountId: account.id, name: account.name,
      configured: !!(account.clientId && account.clientSecret),
      isActive: !!(account.accessToken && account.refreshToken),
      clientId: account.clientId, hasClientSecret: !!account.clientSecret,
      initialOrderNumber: account.initialOrderNumber ?? null,
      paymentMethodId: account.paymentMethodId ?? null,
      autoRpsEnabled: account.autoRpsEnabled !== false,
      rpsTargetStatus: account.rpsTargetStatus,
      tokenExpiresAt: account.expiresAt ? new Date(Number(account.expiresAt)).toISOString() : null,
    };
  }

  async saveCredentials(clientId: string, clientSecret?: string, initialOrderNumber?: number | null, paymentMethodId?: string | null) {
    const account = this.accountContext.account;
    if (typeof clientId !== 'string' || !clientId.trim()) throw new BadRequestException('Client ID é obrigatório.');
    if (clientSecret !== undefined && typeof clientSecret !== 'string') throw new BadRequestException('Client Secret inválido.');
    const secret = clientSecret?.trim() || account.clientSecret;
    if (!secret) throw new BadRequestException('Client Secret é obrigatório.');
    if (initialOrderNumber !== undefined && initialOrderNumber !== null && (!Number.isSafeInteger(initialOrderNumber) || initialOrderNumber < 0)) {
      throw new BadRequestException('Número inicial deve ser um inteiro positivo ou vazio.');
    }
    if (paymentMethodId !== undefined && paymentMethodId !== null && !/^[1-9][0-9]*$/.test(String(paymentMethodId))) {
      throw new BadRequestException('ID da forma de pagamento inválido.');
    }
    if (account.clientId !== clientId.trim() || account.clientSecret !== secret) {
      this.tokens = null;
      account.oauthStateHash = null;
      account.oauthStateExpiresAt = null;
    }
    account.clientId = clientId.trim(); account.clientSecret = secret;
    if (initialOrderNumber !== undefined) account.initialOrderNumber = initialOrderNumber;
    if (paymentMethodId !== undefined) account.paymentMethodId = paymentMethodId;
    await this.persistAccount();
  }

  async removeCredentials() {
    Object.assign(this.accountContext.account, { clientId: null, clientSecret: null });
    await this.clearTokens();
  }

  async setInitialOrderNumber(orderNumber: number | null) {
    this.accountContext.account.initialOrderNumber = orderNumber;
    await this.persistAccount();
  }

  async generateAuthorizationUrl(): Promise<string> {
    if (!this.config.client_id || !this.config.client_secret) throw new BadRequestException('Configure as credenciais desta conta primeiro.');
    const state = crypto.randomBytes(32).toString('hex');
    this.accountContext.account.oauthStateHash = this.hashState(state);
    this.accountContext.account.oauthStateExpiresAt = Date.now() + 10 * 60 * 1000;
    await this.persistAccount();
    const params = new URLSearchParams({ response_type: 'code', client_id: this.config.client_id, state });
    return this.config.authorization_url + '?' + params.toString();
  }

  private hashState(state: string) { return crypto.createHash('sha256').update(state).digest('hex'); }

  async findOAuthAccount(state: string) {
    if (typeof state !== 'string' || !state) throw new BadRequestException('State inválido ou expirado.');
    const account = await this.blingIntegrationRepository.findOne({ where: {
      oauthStateHash: this.hashState(state), oauthStateExpiresAt: MoreThan(Date.now()),
    } });
    if (!account) throw new BadRequestException('State inválido ou expirado.');
    return account;
  }

  private async verifyState(state: string): Promise<boolean> {
    const result = await this.blingIntegrationRepository.update({
      id: this.accountContext.account.id, oauthStateHash: this.hashState(state), oauthStateExpiresAt: MoreThan(Date.now()),
    }, { oauthStateHash: null, oauthStateExpiresAt: null });
    this.accountContext.account.oauthStateHash = null;
    this.accountContext.account.oauthStateExpiresAt = null;
    return result.affected === 1;
  }

  /**
   * Troca authorization code por tokens de acesso
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<BlingTokens> {
    try {
      // Verificar state para segurança
      if (!await this.verifyState(state)) {
        throw new BadRequestException('State inválido - possível ataque CSRF');
      }

      const credentials = Buffer.from(
        `${this.config.client_id}:${this.config.client_secret}`
      ).toString('base64');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      const response = await fetch(this.config.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': '1.0',
          'enable-jwt': '1',
          'Authorization': `Basic ${credentials}`
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Erro ao trocar code por tokens: ${response.status} - ${errorText}`);
        throw new BadRequestException('Falha na autenticação com Bling');
      }

      const tokens: BlingTokens = await response.json();

      // Calcular timestamp de expiração
      tokens.expires_at = Date.now() + (tokens.expires_in * 1000);

      this.tokens = tokens;
      this.logger.log('Tokens de acesso obtidos com sucesso');

      // Salvar tokens em arquivo
      await this.persistAccount();

      return tokens;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao trocar código por tokens: A API do Bling demorou mais de 30 segundos para responder');
        throw new BadRequestException('Timeout na autenticação: A API do Bling está lenta. Tente novamente.');
      }
      this.logger.error(`Erro ao obter tokens: ${error.message}`);
      throw error;
    }
  }

  /**
   * Renova access token usando refresh token
   */
  async refreshAccessToken(): Promise<BlingTokens> {
    if (!this.tokens?.refresh_token) {
      throw new BadRequestException('Nenhum refresh token disponível');
    }

    try {
      const credentials = Buffer.from(
        `${this.config.client_id}:${this.config.client_secret}`
      ).toString('base64');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      const response = await fetch(this.config.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': '1.0',
          'enable-jwt': '1',
          'Authorization': `Basic ${credentials}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refresh_token
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Erro ao renovar token: ${response.status} - ${errorText}`);
        throw new BadRequestException('Falha ao renovar token de acesso');
      }

      const newTokens: BlingTokens = await response.json();

      // Calcular timestamp de expiração
      newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);

      this.tokens = newTokens;
      this.logger.log('Token de acesso renovado com sucesso');

      // Salvar tokens atualizados em arquivo
      await this.persistAccount();

      return newTokens;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao renovar token: A API do Bling demorou mais de 30 segundos para responder');
        throw new BadRequestException('Timeout na renovação do token: A API do Bling está lenta. Tente novamente.');
      }
      this.logger.error(`Erro ao renovar token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verifica se o token atual está válido e renova se necessário
   */
  async ensureValidToken(): Promise<string> {
    if (!this.tokens) {
      throw new BadRequestException('Nenhum token disponível. Realize a autenticação primeiro.');
    }

    const now = Date.now();
    const expiresAt = this.tokens.expires_at || 0;

    // Se o token expira em menos de 5 minutos, renove
    if (now >= (expiresAt - 5 * 60 * 1000)) {
      this.logger.log('Token próximo do vencimento, renovando...');
      await this.refreshAccessToken();
    }

    return this.tokens!.access_token;
  }

  /**
   * Faz requisição autenticada para API do Bling
   */
  async makeAuthenticatedRequest(endpoint: string, options: RequestInit = {}, logResponseBody = true): Promise<any> {
    const accessToken = await this.ensureValidToken();

    const url = `${this.config.base_url}${endpoint}`;

    // Log detalhado da requisição
    console.log('=== REQUISIÇÃO BLING ===');
    console.log('URL:', url);
    console.log('Method:', options.method || 'GET');
    if (options.body) {
      console.log('Body:', options.body);
    }
    console.log('========================');

    await this.waitForBlingRateLimit();

    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(60000),
      headers: {
        'enable-jwt': '1',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const responseText = await response.text();
    console.log('=== RESPOSTA BLING ===');
    console.log('Status:', response.status);
    if (logResponseBody) console.log('Response:', responseText);
    console.log('======================');

    if (!response.ok) {
      this.logger.error(`Erro na requisição Bling: ${response.status}${logResponseBody ? ` - ${responseText}` : ''}`);
      let upstreamType: string | undefined;
      let mensagem = `Erro na API Bling: ${response.status} - ${responseText}`;
      try {
        const erro = JSON.parse(responseText)?.error;
        upstreamType = erro?.type;
        const detalhes = [erro?.message, erro?.description,
          ...(Array.isArray(erro?.fields) ? erro.fields.map(field => field?.message) : []),
        ].filter(value => typeof value === 'string').join(' ');
        if ([400, 422].includes(response.status) && /^\/Api\/v3\/nfse(?:\/|$)/.test(endpoint) && /\bE0008\b/.test(detalhes)) {
          mensagem = 'Rejeição E0008: a data/hora de emissão da DPS está posterior ao horário de processamento. '
            + 'Abra esta nota no Bling e confira a data de emissão. Se o dia estiver correto, confira também o horário e o fuso do emissor; '
            + 'se persistir, solicite ao suporte do Bling a conferência da data/hora enviada na DPS. '
            + 'Após corrigir, tente enviar novamente a mesma nota. A correção de fuso no sistema não altera notas já criadas.';
        }
      } catch { /* Preserve the original response for non-JSON failures. */ }
      throw new BlingApiException(response.status, mensagem, upstreamType);
    }

    try {
      return JSON.parse(responseText);
    } catch (e) {
      return { raw: responseText };
    }
  }

  /**
   * Testa conexão com a API do Bling
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.tokens) {
        return {
          success: false,
          message: 'Nenhum token de acesso disponível. Realize a autenticação OAuth primeiro.'
        };
      }

      // Testa chamando o endpoint de contatos
      const result = await this.makeAuthenticatedRequest('/contatos?limite=1');

      return {
        success: true,
        message: `Conexão OK. API respondeu com ${result.data?.length || 0} contatos.`
      };
    } catch (error) {
      return {
        success: false,
        message: `Falha na conexão: ${error.message}`
      };
    }
  }

  /**
   * Obtém informações dos tokens atuais
   */
  getTokenInfo(): any {
    if (!this.tokens) {
      return { authenticated: false };
    }

    const now = Date.now();
    const expiresAt = this.tokens.expires_at || 0;
    const isExpired = now >= expiresAt;
    const expiresIn = Math.max(0, Math.floor((expiresAt - now) / 1000));

    return {
      authenticated: true,
      token_type: this.tokens.token_type,
      scope: this.tokens.scope,
      expires_in: expiresIn,
      is_expired: isExpired,
      expires_at: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Define tokens manualmente (para testes ou importação)
   */
  async setTokens(tokens: BlingTokens): Promise<void> {
    if (!tokens.expires_at) tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    this.tokens = tokens;
    await this.persistAccount();
  }

  async clearTokens(): Promise<void> {
    this.tokens = null;
    this.accountContext.account.oauthStateHash = null;
    this.accountContext.account.oauthStateExpiresAt = null;
    await this.persistAccount();
  }

  // Emitir Nota Fiscal de Serviço (NFSe)
  async emitirNFSe(dadosNota: any): Promise<any> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      console.log('🔗 API URL:', apiUrl);
      console.log('🎯 Payload NFSe (corrigido conforme OpenAPI Bling):');
      console.log(JSON.stringify(dadosNota, null, 2));

      // Criar AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 segundos timeout

      const response = await fetch(
        `${apiUrl}/nfse`,
        {
          method: 'POST',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(dadosNota),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(`Erro ao emitir NFSe: ${response.status} - ${errorData}`);
        console.error('🚨 Resposta de erro completa:', errorData);
        throw new Error(`Erro ao emitir NFSe: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log('✅ NFSe criada com sucesso:', result);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao emitir NFSe - API demorou mais de 45 segundos para responder');
        throw new Error('Timeout: A API do Bling demorou mais de 45 segundos para emitir a NFSe.');
      }
      console.error('❌ Erro ao emitir NFSe:', error.message);
      throw new Error(`Erro ao emitir NFSe: ${error.message}`);
    }
  }

  // Enviar NFSe para o cliente
  async enviarNFSe(idNotaServico: number): Promise<any> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      // Criar AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 segundos timeout

      const response = await fetch(
        `${apiUrl}/nfse/${idNotaServico}/enviar`,
        {
          method: 'POST',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({}),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(`Erro ao enviar NFSe: ${response.status} - ${errorData}`);
        throw new Error(`Erro ao enviar NFSe: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log('NFSe enviada com sucesso:', result);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao enviar NFSe - API demorou mais de 120 segundos para responder');
        throw new Error('Timeout: A API do Bling demorou mais de 120 segundos para responder. A NFSe foi emitida mas pode não ter sido enviada.');
      }
      console.error('Erro ao enviar NFSe:', error.message);
      throw new Error(`Erro ao enviar NFSe: ${error.message}`);
    }
  }

  // Processar fila de duplicatas - emitir NFSe para cada uma
  async processarFilaDuplicatas(duplicatas: any[]): Promise<NFSeResultado[]> {
    const resultados: NFSeResultado[] = [];

    for (const duplicata of duplicatas) {
      try {
        console.log(`🔍 Processando duplicata #${duplicata.numero}...`);

        // NOVO FLUXO: Verificar se contato já existe, senão criar, e buscar dados completos do Bling
        const dadosContatoBling = await this.verificarOuCriarContato(duplicata);
        console.log(`✅ Contato verificado/criado: ID ${dadosContatoBling.id} - ${dadosContatoBling.nome}`);

        // Aguardar 1 segundo para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Criar dados da NFSe usando os dados completos do contato do Bling
        const dadosNFSe = this.criarDadosNFSe(duplicata, dadosContatoBling);

        // Emitir a NFSe
        const nfseResult = await this.emitirNFSe(dadosNFSe);

        // Aguardar 1 segundo para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Se a emissão foi bem-sucedida, tentar enviar automaticamente
        if (nfseResult?.data?.id) {
          let enviada = false;

          try {
            console.log(`📤 Enviando NFSe #${nfseResult.data.id}...`);

            await this.enviarNFSe(nfseResult.data.id);
            enviada = true;

            // Aguardar 1 segundo para não sobrecarregar a API
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (envioError) {
            console.warn(`⚠️ Falha no envio da NFSe: ${envioError.message}`);
          }

          // NÃO SALVAR DADOS PARCIAIS - REMOVIDO CONFORME SOLICITAÇÃO
          resultados.push({
            duplicata: duplicata.numero,
            status: 'emitida',
            nfseId: nfseResult.data.id,
            numero: null, // Ainda não verificado
            rps: nfseResult.data.numeroRps,
            idNota: nfseResult.data.id.toString(),
            dataEmissao: nfseResult.data.dataEmissao || nfseResult.data.dataCriacao, // Capturar data de emissão ou criação
            enviada: enviada,
            mensagem: enviada ? 'NFSe emitida e enviada com sucesso' : 'NFSe emitida mas envio falhou'
          });
        } else {
          resultados.push({
            duplicata: duplicata.numero,
            status: 'erro',
            mensagem: 'NFSe criada mas sem ID retornado'
          });
        }

      } catch (error) {
        console.error(`❌ Erro ao processar duplicata #${duplicata.numero}:`, error.message);
        resultados.push({
          duplicata: duplicata.numero,
          status: 'erro',
          mensagem: error.message
        });
      }
    }

    return resultados;
  }

  // FASE 2: Verificar situação das NFSe já emitidas e salvar dados
  async verificarSituacaoNFSeEmitidas(nfseIds: number[]): Promise<NFSeResultado[]> {
    const resultados: NFSeResultado[] = [];

    console.log(`🔍 Iniciando verificação de situação para ${nfseIds.length} NFSe(s)...`);

    for (const nfseId of nfseIds) {
      try {
        console.log(`🔍 Verificando situação da NFSe ID: ${nfseId}`);

        // Buscar situação da NFSe
        const situacaoNFSe = await this.buscarSituacaoNFSe(nfseId);

        if (situacaoNFSe?.numero) {
          console.log(`✅ Situação da NFSe ${nfseId} obtida: Número ${situacaoNFSe.numero}`);

          // Aqui precisaríamos encontrar a duplicata correspondente
          // Por enquanto, vamos marcar como sucesso mas sem salvar na planilha
          // O frontend precisará mapear pelo nfseId

          resultados.push({
            duplicata: null, // Será preenchido pelo frontend
            status: 'verificado',
            nfseId: nfseId,
            numero: situacaoNFSe.numero,
            rps: null, // Já temos do resultado anterior
            idNota: nfseId.toString(),
            dataEmissao: situacaoNFSe.dataEmissao,
            enviada: true, // Já foi enviada na fase 1
            mensagem: 'Situação verificada e número obtido'
          });
        } else {
          console.warn(`⚠️ NFSe ${nfseId} ainda não tem número`);
          resultados.push({
            duplicata: null,
            status: 'pendente',
            nfseId: nfseId,
            numero: null,
            mensagem: 'NFSe ainda não tem número'
          });
        }

        // Aguardar entre verificações
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`❌ Erro ao verificar NFSe ${nfseId}:`, error.message);
        resultados.push({
          duplicata: null,
          status: 'erro',
          nfseId: nfseId,
          mensagem: `Erro na verificação: ${error.message}`
        });
      }
    }

    return resultados;
  }

  // NOVO: Verificar se contato existe pelo CPF, senão criar
  async verificarOuCriarContato(duplicata: any): Promise<any> {
    try {
      // Debug: Log da estrutura completa da duplicata
      console.log('🔍 DEBUG - Estrutura completa da duplicata:', JSON.stringify(duplicata, null, 2));

      const cpf = duplicata.responsavel?.cpf?.replace(/\D/g, ''); // Remove formatação

      // Debug: Log específico do CPF
      console.log('🔍 DEBUG - CPF original:', duplicata.responsavel?.cpf);
      console.log('🔍 DEBUG - CPF limpo:', cpf);
      console.log('🔍 DEBUG - Objeto responsavel:', JSON.stringify(duplicata.responsavel, null, 2));

      if (!cpf) {
        const studentInfo = duplicata.nomeAluno ? ` (${duplicata.nomeAluno})` : '';
        throw new Error(`CPF não informado na duplicata #${duplicata.numero}${studentInfo}. Verifique se o campo CPF do responsável está preenchido corretamente.`);
      }

      console.log(`🔍 Buscando contato no Bling por CPF: ${cpf}`);

      // Buscar contato existente por CPF
      const contatoExistente = await this.buscarContatoPorCPF(cpf);

      // Aguardar 1 segundo para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 1000));

      let contatoId: number;

      if (contatoExistente) {
        console.log(`✅ Contato encontrado: ${contatoExistente.nome} (ID: ${contatoExistente.id})`);
        contatoId = contatoExistente.id;
      } else {
        // Se não encontrou, criar novo contato
        console.log(`📝 Contato não encontrado. Criando novo contato...`);
        const novoContato = await this.criarContato(duplicata);
        console.log(`✅ Novo contato criado: ${novoContato.nome} (ID: ${novoContato.id})`);
        contatoId = novoContato.id;

        // Aguardar 1 segundo para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // NOVA SEQUÊNCIA: Buscar dados completos do contato no Bling
      console.log(`🔍 Buscando dados completos do contato ID: ${contatoId} no Bling...`);
      const dadosCompletos = await this.obterDetalhesContato(contatoId);

      // Aguardar 1 segundo para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (!dadosCompletos) {
        throw new Error(`Não foi possível obter os dados completos do contato ID: ${contatoId} no Bling`);
      }

      console.log(`✅ Dados completos do contato obtidos do Bling:`, JSON.stringify(dadosCompletos, null, 2));

      return dadosCompletos;

    } catch (error) {
      console.error(`❌ Erro ao verificar/criar contato:`, error.message);
      throw new Error(`Erro ao verificar/criar contato: ${error.message}`);
    }
  }

  // Buscar contato existente por CPF (método público para testes)
  async buscarContatoPorCPF(cpf: string): Promise<any | null> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      // Criar AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      // ENDPOINT CORRIGIDO: usar parâmetro "pesquisa" ao invés de "numeroDocumento"
      const response = await fetch(
        `${apiUrl}/contatos?pagina=1&limite=1&pesquisa=${cpf}`,
        {
          method: 'GET',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`❌ Erro ao buscar contato: ${response.status} - ${errorData}`);
        return null; // Não falha, apenas retorna null se não encontrar
      }

      const result = await response.json();
      console.log(`🔍 Resultado da busca por CPF ${cpf}:`, JSON.stringify(result, null, 2));

      if (result.data && result.data.length > 0) {
        // Verificar se o CPF realmente bate (já que pesquisa pode retornar resultados similares)
        const contatoEncontrado = result.data.find(contato =>
          contato.numeroDocumento && contato.numeroDocumento.replace(/\D/g, '') === cpf
        );

        if (contatoEncontrado) {
          console.log(`✅ Contato encontrado com CPF exato: ${contatoEncontrado.nome} (ID: ${contatoEncontrado.id})`);
          return contatoEncontrado;
        }

        console.log(`ℹ️ Nenhum contato encontrado com CPF exato: ${cpf}`);
        return null;
      }

      console.log(`ℹ️ Nenhum contato encontrado na pesquisa por CPF: ${cpf}`);
      return null; // Não encontrou contato com este CPF

    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error(`Timeout ao buscar contato por CPF ${cpf} - API demorou mais de 30 segundos`);
        return null; // Em timeout, retorna null para tentar criar contato
      }
      console.error(`❌ Erro ao buscar contato por CPF:`, error.message);
      return null; // Em caso de erro, retorna null para tentar criar
    }
  }

  // Obter detalhes completos de um contato pelo ID
  async obterDetalhesContato(id: number): Promise<any | null> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      console.log(`🔍 Buscando detalhes do contato ID: ${id}`);

      // Criar AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      await this.waitForBlingRateLimit();

      const response = await fetch(
        `${apiUrl}/contatos/${id}`,
        {
          method: 'GET',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Accept': 'application/json'
          },
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`❌ Erro ao buscar detalhes do contato: ${response.status} - ${errorData}`);
        return null;
      }

      const result = await response.json();

      if (result.data) {
        console.log(`✅ Detalhes do contato obtidos: ${result.data.nome}`);
        return result.data;
      }

      console.log(`ℹ️ Contato não encontrado: ID ${id}`);
      return null;

    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error(`Timeout ao obter detalhes do contato ID ${id} - API demorou mais de 30 segundos`);
        return null; // Em timeout, retorna null
      }
      console.error(`❌ Erro ao obter detalhes do contato:`, error.message);
      return null;
    }
  }

  // Criar novo contato no Bling (método público para testes)
  async criarContato(duplicata: any): Promise<any> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      // Extrair e processar dados completos da duplicata
      const responsavel = duplicata.responsavel || {};
      const cpfLimpo = responsavel.cpf?.replace(/\D/g, '') || '';
      const cepLimpo = responsavel.cep?.replace(/\D/g, '') || '';
      const telefoneLimpo = responsavel.celular?.replace(/\D/g, '') || '';

      // Estrutura completa conforme documentação oficial do Bling
      const dadosContato = {
        nome: responsavel.nome || `Responsável por ${duplicata.nomeAluno}`,
        codigo: "", // Código interno (opcional)
        situacao: "A", // Ativo
        numeroDocumento: cpfLimpo,
        telefone: "", // Telefone fixo (opcional)
        celular: telefoneLimpo,
        fantasia: "", // Nome fantasia (opcional para PF)
        tipo: "F", // F = Pessoa Física, J = Pessoa Jurídica
        indicadorIe: 9, // 9 = Não contribuinte (padrão para PF)
        ie: "", // Inscrição Estadual (vazio para PF)
        rg: "", // RG (opcional)
        inscricaoMunicipal: "", // Inscrição Municipal (opcional)
        orgaoEmissor: "", // Órgão emissor do RG (opcional)
        email: responsavel.email || "",
        emailNotaFiscal: responsavel.email || "", // Email para envio de NF
        endereco: {
          geral: {
            endereco: responsavel.endereco || "",
            cep: cepLimpo || "",
            bairro: responsavel.bairro || "",
            municipio: "Betim",
            uf: "MG",
            numero: "S/N", // Número da residência
            complemento: "" // Complemento do endereço
          },
          cobranca: {
            endereco: responsavel.endereco || "",
            cep: cepLimpo || "",
            bairro: responsavel.bairro || "",
            municipio: "Betim",
            uf: "MG",
            numero: "S/N",
            complemento: ""
          }
        },
        vendedor: {
          id: 0 // ID do vendedor (opcional)
        },
        dadosAdicionais: {
          dataNascimento: "0000-00-00", // Data de nascimento (opcional)
          sexo: "", // M/F (opcional)
          naturalidade: "Brasileira" // Naturalidade (opcional)
        },
        financeiro: {
          limiteCredito: 0, // Limite de crédito (opcional)
          condicaoPagamento: "", // Condição de pagamento (opcional)
          categoria: {
            id: 0 // ID da categoria do contato (opcional)
          }
        },
        pais: {
          nome: "BRASIL" // País padrão
        },
        tiposContato: [], // Tipos de contato (opcional)
        pessoasContato: [] // Pessoas de contato (opcional)
      };

      console.log(`📝 Criando contato no Bling:`, JSON.stringify(dadosContato, null, 2));

      // Criar AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      const response = await fetch(
        `${apiUrl}/contatos`,
        {
          method: 'POST',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(dadosContato),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`❌ Erro ao criar contato: ${response.status} - ${errorData}`);
        throw new Error(`Erro ao criar contato: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log(`✅ Contato criado com sucesso:`, result);

      // Retornar o contato criado com o ID
      return {
        id: result.data.id,
        nome: dadosContato.nome,
        numeroDocumento: dadosContato.numeroDocumento,
        email: dadosContato.email,
        celular: dadosContato.celular,
        endereco: dadosContato.endereco
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao criar contato - API demorou mais de 30 segundos para responder');
        throw new Error('Timeout: A API do Bling demorou mais de 30 segundos para criar o contato.');
      }
      console.error(`❌ Erro ao criar contato:`, error.message);
      throw new Error(`Erro ao criar contato: ${error.message}`);
    }
  }

  // Criar estrutura de dados da NFSe baseada na duplicata e dados do contato do Bling
  private criarDadosNFSe(duplicata: any, dadosContatoBling: any, parcelaEspecifica?: number): any {
    // Extrair valor numérico (pode ser string ou número)
    let valor = 0;
    if (typeof duplicata.valor === 'string') {
      const valorString = duplicata.valor.replace('R$', '').replace(',', '.').trim();
      valor = parseFloat(valorString) || 0;
    } else if (typeof duplicata.valor === 'number') {
      valor = duplicata.valor;
    }

    // Determinar parcela a usar (específica ou global)
    const parcelaParaUsar = parcelaEspecifica || duplicata.parcela || this.parcelaAtual;

    // Utilizar RPS existente quando disponível, caso contrário gerar um novo baseado no timestamp e no número da duplicata
    const rpsExistente = (duplicata.rps ?? '').toString().trim();
    let numeroRPS: string;
    let timestampGerado: number | null = null;

    if (rpsExistente.length > 0) {
      numeroRPS = rpsExistente;
      console.log(`?? Utilizando RPS já definido para duplicata #${duplicata.numero}: ${numeroRPS}`);
    } else {
      timestampGerado = Date.now();
      numeroRPS = `${timestampGerado}${duplicata.numero}`;
      console.log(`?? Gerando RPS único para duplicata #${duplicata.numero}: ${numeroRPS} (timestamp: ${timestampGerado})`);
    }

    const currentDate = this.dataEmissaoHoje();

    console.log(`?? Criando dados NFSe usando dados do Bling para contato ID: ${dadosContatoBling.id}`);
    console.log(`?? Dados do contato do Bling:`, JSON.stringify(dadosContatoBling, null, 2));

    return {
      // Campos obrigatórios conforme documentação oficial do Bling
      numeroRPS: numeroRPS,
      serie: "1",
      data: currentDate,
      dataEmissao: currentDate, // Campo adicional da documentação

      // Contato (obrigatório) - seguindo formato exato da documentação
      contato: {
        id: dadosContatoBling.id,
        nome: dadosContatoBling.nome,
        numeroDocumento: dadosContatoBling.numeroDocumento,
        email: dadosContatoBling.email,
        telefone: dadosContatoBling.celular || "",
        endereco: dadosContatoBling.endereco?.geral ? {
          endereco: dadosContatoBling.endereco.geral.endereco,
          numero: dadosContatoBling.endereco.geral.numero || "S/N",
          complemento: dadosContatoBling.endereco.geral.complemento || "",
          bairro: dadosContatoBling.endereco.geral.bairro,
          cep: dadosContatoBling.endereco.geral.cep,
          municipio: dadosContatoBling.endereco.geral.municipio,
          uf: dadosContatoBling.endereco.geral.uf
        } : undefined
      },

      // Campos financeiros conforme documentação
      baseCalculo: valor,
      reterISS: false,
      desconto: 0,
      tributacaoIbsCbs: {
        indicadorOperacao: "050101",
        tipoOperacao: "1",
        tributacao: {
          classificacaoTributaria: "000001",
          codigoSituacaoTributaria: "000"
        }
      },

      // Serviços (obrigatório) - serviço único configurado
      servicos: [{
        codigo: this.codigosServico[this.codigoServicoAtual].codigo,
        descricao: this.codigosServico[this.codigoServicoAtual].descricao,
        valor: valor
      }],

      // Parcelas (opcional) - formato exato da documentação
      parcelas: [{
        data: currentDate,
        valor: valor,
        observacoes: `PARCELA ${parcelaParaUsar} - Referente a ${this.codigosServico[this.codigoServicoAtual].descricao}`,
        formaPagamento: {
          id: 1 // ID da forma de pagamento
        }
      }]
    };
  }

  /**
   * Configurar código de serviço a ser usado nas NFSe
   */
  async configurarCodigoServico(codigo: string): Promise<boolean> {
    if (!this.codigosServico[codigo]) {
      this.logger.error(`Código de serviço inválido: ${codigo}`);
      return false;
    }

    this.accountContext.account.serviceCode = codigo;
    await this.persistAccount();
    this.logger.log(`Código de serviço configurado para: ${codigo} - ${this.codigosServico[codigo].descricao}`);
    return true;
  }

  /**
   * Configurar parcela a ser usada nas NFSe
   */
  async configurarParcela(parcela: number): Promise<boolean> {
    if (!Number.isInteger(parcela) || parcela < 1 || parcela > 12) {
      this.logger.error(`Número de parcela inválido: ${parcela}. Deve ser entre 1 e 12.`);
      return false;
    }

    this.accountContext.account.installment = parcela;
    await this.persistAccount();
    this.logger.log(`Parcela configurada para: ${parcela}`);
    return true;
  }

  /**
   * Obter códigos de serviço disponíveis
   */
  obterCodigosServico() {
    return {
      atual: this.codigoServicoAtual,
      parcela: this.parcelaAtual,
      disponíveis: this.codigosServico
    };
  }

  /**
   * Obter código de serviço atual
   */
  obterCodigoServicoAtual(): string {
    return this.codigoServicoAtual;
  }

  /**
   * Obter parcela atual
   */
  obterParcelaAtual(): number {
    return this.parcelaAtual;
  }

  /**
   * Buscar configurações de NFSe do Bling
   */
  async buscarConfiguracoesNFSe(): Promise<any> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      console.log('🔍 Buscando configurações de NFSe do Bling...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

      const response = await fetch(
        `${apiUrl}/nfse/configuracoes`,
        {
          method: 'GET',
          headers: {
            'enable-jwt': '1',

            'Authorization': `Bearer ${this.tokens?.access_token}`,
            'Accept': 'application/json'
          },
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(`Erro ao buscar configurações NFSe: ${response.status} - ${errorData}`);
        throw new Error(`Erro ao buscar configurações NFSe: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log('✅ Configurações NFSe obtidas:', JSON.stringify(result, null, 2));

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ Timeout ao buscar configurações NFSe: A API do Bling demorou mais de 30 segundos para responder');
        throw new Error('Timeout ao buscar configurações NFSe: A API do Bling está lenta. Tente novamente.');
      }
      console.error('❌ Erro ao buscar configurações NFSe:', error.message);
      throw new Error(`Erro ao buscar configurações NFSe: ${error.message}`);
    }
  }

  /**
   * Consultar situação da NFSe pelo ID com múltiplas tentativas
   */
  async buscarSituacaoNFSe(idNotaServico: number): Promise<any> {
    const maxTentativas = 5;
    const delayEntreTentativas = 40000; // 40 segundos

    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      try {
        console.log(`🔍 [Tentativa ${tentativa}/${maxTentativas}] Consultando situação da NFSe ID: ${idNotaServico}`);

        await this.ensureValidToken();

        const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout por tentativa

        const response = await fetch(
          `${apiUrl}/nfse/${idNotaServico}`,
          {
            method: 'GET',
            headers: {
              'enable-jwt': '1',

              'Authorization': `Bearer ${this.tokens?.access_token}`,
              'Accept': 'application/json'
            },
            signal: controller.signal
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.text();
          console.warn(`⚠️ [Tentativa ${tentativa}/${maxTentativas}] Erro ao consultar situação da NFSe: ${response.status} - ${errorData}`);

          if (tentativa < maxTentativas) {
            console.log(`⏳ Aguardando ${delayEntreTentativas / 1000} segundos antes da próxima tentativa...`);
            await new Promise(resolve => setTimeout(resolve, delayEntreTentativas));
            continue;
          } else {
            console.error(`❌ Todas as ${maxTentativas} tentativas falharam para consultar situação da NFSe`);
            return null;
          }
        }

        const result = await response.json();

        if (result.data?.numero) {
          console.log(`✅ [Tentativa ${tentativa}/${maxTentativas}] Situação da NFSe ${idNotaServico} obtida: Número ${result.data.numero}`);
          return result.data;
        } else {
          console.warn(`⚠️ [Tentativa ${tentativa}/${maxTentativas}] NFSe ${idNotaServico} ainda não tem número. Situação: ${result.data?.situacao || 'desconhecida'}`);

          if (tentativa < maxTentativas) {
            console.log(`⏳ Aguardando ${delayEntreTentativas / 1000} segundos antes da próxima tentativa...`);
            await new Promise(resolve => setTimeout(resolve, delayEntreTentativas));
            continue;
          } else {
            console.error(`❌ NFSe ${idNotaServico} não obteve número após ${maxTentativas} tentativas`);
            return null;
          }
        }

      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(`⚠️ [Tentativa ${tentativa}/${maxTentativas}] Timeout ao consultar situação da NFSe ID ${idNotaServico} - API demorou mais de 30 segundos`);
        } else {
          console.warn(`⚠️ [Tentativa ${tentativa}/${maxTentativas}] Erro ao consultar situação da NFSe: ${error.message}`);
        }

        if (tentativa < maxTentativas) {
          console.log(`⏳ Aguardando ${delayEntreTentativas / 1000} segundos antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, delayEntreTentativas));
          continue;
        } else {
          console.error(`❌ Todas as ${maxTentativas} tentativas falharam para consultar situação da NFSe`);
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Busca pedidos de venda do Bling
   */
  async getPedidosVenda(params: {
    pagina?: number;
    limite?: number;
    numero?: number;
    dataInicial?: string;
    dataFinal?: string;
    idContato?: number;
    idsSituacoes?: number[];
  }): Promise<any> {
    try {
      await this.ensureValidToken();

      const apiUrl = this.configService.get('BLING_API_URL') || `${this.config.base_url}/Api/v3`;

      // Construir query params
      const queryParams = new URLSearchParams();

      if (params.pagina) queryParams.append('pagina', params.pagina.toString());
      if (params.limite) queryParams.append('limite', params.limite.toString());
      if (params.numero) queryParams.append('numero', params.numero.toString());
      if (params.dataInicial) queryParams.append('dataInicial', params.dataInicial);
      if (params.dataFinal) queryParams.append('dataFinal', params.dataFinal);
      if (params.idContato) queryParams.append('idContato', params.idContato.toString());
      if (params.idsSituacoes && params.idsSituacoes.length > 0) {
        params.idsSituacoes.forEach(id => queryParams.append('idsSituacoes[]', id.toString()));
      }

      const url = `${apiUrl}/pedidos/vendas${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

      this.logger.log(`🔍 Buscando pedidos de venda: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      await this.waitForBlingRateLimit();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'enable-jwt': '1',

          'Authorization': `Bearer ${this.tokens?.access_token}`,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(`Erro ao buscar pedidos de venda: ${response.status} - ${errorData}`);
        throw new Error(`Erro ao buscar pedidos de venda: ${response.status}`);
      }

      const result = await response.json();
      this.logger.log(`✅ Pedidos de venda obtidos: ${result.data?.length || 0} registros`);

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('Timeout ao buscar pedidos de venda');
        throw new Error('Timeout ao buscar pedidos de venda. A API do Bling está lenta.');
      }
      this.logger.error(`Erro ao buscar pedidos de venda: ${error.message}`);
      throw error;
    }
  }

  /**
   * =====================================================
   * MÉTODOS PARA GERAÇÃO DE RPS
   * =====================================================
   */

  /**
   * Obter detalhes completos de um pedido de venda
   */
  async obterDetalhesPedidoVenda(pedidoId: number): Promise<any> {
    try {
      this.logger.log(`Buscando detalhes do pedido ${pedidoId}...`);
      const response = await this.makeAuthenticatedRequest(`/Api/v3/pedidos/vendas/${pedidoId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao obter detalhes do pedido ${pedidoId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obter detalhes de um produto por ID
   */
  async obterDetalhesProduto(produtoId: number): Promise<any> {
    try {
      const response = await this.makeAuthenticatedRequest(`/Api/v3/produtos/${produtoId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao obter detalhes do produto ${produtoId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obter formas de pagamento disponíveis
   */
  async obterFormasPagamento(): Promise<{ id: number; descricao: string }[]> {
    const formas: { id: number; descricao: string }[] = [];
    const limite = 100;
    for (let pagina = 1; ; pagina++) {
      const response = await this.makeAuthenticatedRequest(
        `/Api/v3/formas-pagamentos?pagina=${pagina}&limite=${limite}&situacao=1`,
      );
      if (!Array.isArray(response?.data)) {
        throw new BadRequestException('Resposta inválida ao consultar formas de pagamento no Bling.');
      }
      for (const forma of response.data) {
        if (forma.situacao !== 0) formas.push({ id: forma.id, descricao: forma.descricao });
      }
      if (response.data.length < limite) break;
    }
    return formas;
  }

  /**
   * Verificar se o pedido é de consumidor final
   */
  private isConsumidorFinal(pedido: any): boolean {
    // Se não tem contato ou não tem CPF/CNPJ válido, é consumidor final
    if (!pedido.contato || !pedido.contato.numeroDocumento) {
      return true;
    }

    const doc = pedido.contato.numeroDocumento.replace(/\D/g, '');

    // Se o documento está vazio ou inválido, é consumidor final
    if (!doc || doc.length < 11) {
      return true;
    }

    return false;
  }

  /**
   * Construir payload NFSe para envio ao Bling
   */
  private async construirPayloadNFSe(
    pedido: any,
    contato: any,
    servicos: any[],
    formaPagamentoId: number
  ): Promise<any> {
    const valorTotal = servicos.reduce((sum, s) => sum + parseFloat(s.valor || 0), 0);

    // Gerar número RPS: número do pedido + números aleatórios = 8 dígitos
    const numeroPedido = String(pedido.numero);
    const digitosRestantes = 8 - numeroPedido.length;
    const aleatorio = digitosRestantes > 0
      ? Math.floor(Math.random() * Math.pow(10, digitosRestantes)).toString().padStart(digitosRestantes, '0')
      : '';
    const numeroRPS = `${numeroPedido}${aleatorio}`.slice(0, 8);

    const dataHoje = this.dataEmissaoHoje();

    // Payload baseado na documentação oficial do Bling API v3
    // POST /nfse - NotasServicosDadosBaseDTO_POST + NotasServicosDadosDTO_POST
    const payload: any = {
      // Campos de NotasServicosDadosBase (obrigatórios: numeroRPS, serie, contato)
      numeroRPS: numeroRPS,
      serie: "1",

      // Campos de NotasServicosDadosDTO_POST
      data: dataHoje,
      dataEmissao: dataHoje,
      baseCalculo: valorTotal,
      reterISS: false,
      desconto: 0,
      tributacaoIbsCbs: {
        indicadorOperacao: "050101",
        tipoOperacao: "1",
        tributacao: {
          classificacaoTributaria: "000001",
          codigoSituacaoTributaria: "000"
        }
      },

      // Contato - NotasServicosContatoBaseDTO (obrigatórios: id, nome, numeroDocumento, email)
      // + NotasServicosContatoDTO (opcionais: ie, telefone, im, endereco)
      contato: {
        id: contato.id,
        nome: contato.nome,
        numeroDocumento: contato.numeroDocumento || contato.cpfCnpj || "",
        email: contato.email || "naotem@email.com"
      },

      // Serviços - NotasServicosServicoDTO (obrigatórios: codigo, descricao, valor)
      servicos: [{
        codigo: "050801", // Código de serviço
        descricao: "Serviços de Estética Animal (banho e tosa)",
        valor: valorTotal
      }],

      // Parcelas - NotasServicosParcelaDTO (obrigatórios: data, valor)
      parcelas: [{
        data: dataHoje,
        valor: valorTotal,
        observacoes: `Pedido ${pedido.numero}`,
        formaPagamento: {
          id: formaPagamentoId
        }
      }]
    };

    // Adicionar campos opcionais do contato se existirem
    if (contato.ie) {
      payload.contato.ie = contato.ie;
    }
    if (contato.im) {
      payload.contato.im = contato.im;
    }
    if (contato.celular || contato.telefone) {
      payload.contato.telefone = contato.celular || contato.telefone;
    }

    // Adicionar endereço se existir
    if (contato.endereco?.geral) {
      const endGeral = contato.endereco.geral;
      if (endGeral.bairro && endGeral.municipio) {
        payload.contato.endereco = {
          endereco: endGeral.endereco || "",
          numero: endGeral.numero || "S/N",
          complemento: endGeral.complemento || "",
          bairro: endGeral.bairro,
          cep: endGeral.cep || "",
          municipio: endGeral.municipio,
          uf: endGeral.uf || ""
        };
      }
    }

    // Adicionar vendedor se existir no pedido
    if (pedido.vendedor?.id) {
      payload.vendedor = {
        id: pedido.vendedor.id
      };
    }

    console.log('🔵 [construirPayloadNFSe] Payload gerado:', JSON.stringify(payload, null, 2));

    return payload;
  }

  /**
   * Gerar RPS para múltiplos pedidos de venda
   */
  async gerarRPSParaPedidos(pedidoIds: number[]): Promise<any> {
    console.log('🔵 [Service gerarRPSParaPedidos] Iniciando com pedidoIds:', pedidoIds);
    this.logger.log(`Iniciando geração de RPS para ${pedidoIds.length} pedidos...`);

    const resultados: any[] = [];
    let processados = 0;

    for (const pedidoId of pedidoIds) {
      try {
        console.log(`🔵 [Service] Processando pedido ${pedidoId}...`);

        // 1. Buscar detalhes do pedido
        const pedido = await this.obterDetalhesPedidoVenda(pedidoId);
        console.log(`🔵 [Service] Pedido ${pedidoId} carregado:`, pedido?.numero);

        if (Number(pedido.situacao?.id) === 2) {
          resultados.push({ pedidoId, status: 'ignorado', mensagem: 'Pedido cancelado' });
          continue;
        }

        // 2. Verificar se é consumidor final
        if (this.isConsumidorFinal(pedido)) {
          console.log(`🟡 [Service] Pedido ${pedidoId} é consumidor final - ignorando`);
          resultados.push({
            pedidoId,
            numeroPedido: pedido.numero,
            status: 'ignorado',
            mensagem: 'Pedido é consumidor final - RPS não será gerado'
          });
          continue;
        }

        // 3. Verificar se RPS já existe
        const rpsExistente = await this.rpsService.buscarPorPedidoId(pedidoId);
        if (rpsExistente) {
          resultados.push({
            pedidoId,
            numeroPedido: pedido.numero,
            status: 'ignorado',
            mensagem: 'RPS já existe para este pedido',
            numeroRPS: rpsExistente.numeroRPS
          });
          continue;
        }

        // 4. Buscar detalhes do contato
        const contato = await this.obterDetalhesContato(pedido.contato.id);

        // 5. Processar itens do pedido e filtrar serviços
        const servicos: any[] = [];

        if (pedido.itens && pedido.itens.length > 0) {
          for (const item of pedido.itens) {
            try {
              const produto = await this.obterDetalhesProduto(item.produto.id);

              // Verificar se é serviço (tipo 'S')
              if (produto.tipo === 'S') {
                servicos.push({
                  descricao: produto.descricao || item.descricao,
                  valor: item.valor || item.valorUnidade || 0
                });
              }
            } catch (error) {
              this.logger.warn(`Erro ao buscar produto ${item.produto.id}: ${error.message}`);
            }
          }
        }

        // 6. Verificar se há serviços
        if (servicos.length === 0) {
          resultados.push({
            pedidoId,
            numeroPedido: pedido.numero,
            status: 'ignorado',
            mensagem: 'Pedido não contém serviços'
          });
          continue;
        }

        // 7. Forma de pagamento configurada para esta conta
        const formaPagamentoId = Number(this.accountContext.account.paymentMethodId);
        if (!Number.isSafeInteger(formaPagamentoId) || formaPagamentoId <= 0) {
          throw new BadRequestException('Configure a forma de pagamento desta conta antes de gerar RPS.');
        }

        // 8. Construir payload NFSe
        const payload = await this.construirPayloadNFSe(pedido, contato, servicos, formaPagamentoId);

        // 9. Emitir NFSe
        this.logger.log(`Emitindo NFSe para pedido ${pedido.numero}...`);
        const nfseResponse = await this.makeAuthenticatedRequest('/Api/v3/nfse', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        // 10. Salvar no banco de dados como PENDENTE (ainda não enviado para prefeitura)
        const valorTotal = servicos.reduce((sum, s) => sum + parseFloat(s.valor || 0), 0);

        await this.rpsService.criar({
          pedidoVendaId: String(pedidoId),
          numeroPedido: String(pedido.numero),
          numeroRPS: nfseResponse.data.numeroRPS || payload.numeroRPS,
          serie: nfseResponse.data.serie || payload.serie,
          nfseId: String(nfseResponse.data.id),
          status: 'pendente', // Pendente até ser enviado para prefeitura
          valorTotal: valorTotal,
          nomeCliente: contato.nome,
          dataEmissao: new Date()
        });

        processados++;

        resultados.push({
          pedidoId,
          numeroPedido: pedido.numero,
          status: 'sucesso',
          numeroRPS: nfseResponse.data.numeroRPS,
          nfseId: nfseResponse.data.id,
          mensagem: 'RPS gerado com sucesso'
        });

      } catch (error) {
        this.logger.error(`Erro ao processar pedido ${pedidoId}: ${error.message}`);

        resultados.push({
          pedidoId,
          numeroPedido: pedidoId,
          status: 'erro',
          mensagem: error.message || 'Erro ao gerar RPS'
        });
      }
    }

    this.logger.log(`✅ Geração de RPS concluída: ${processados} de ${pedidoIds.length} processados com sucesso`);

    return {
      success: true,
      processados,
      total: pedidoIds.length,
      resultados
    };
  }

  private situacaoNFSe(nfse: any): 'emitido' | 'erro' | 'pendente' | null {
    // Bling OpenAPI: 0 pending, 1 issued, 2 available for consultation, 3 cancelled.
    if (nfse?.situacao === 3) return 'erro';
    if (nfse?.situacao === 1 || nfse?.situacao === 2) return 'emitido';
    if (nfse?.situacao === 0) return 'pendente';
    if (nfse?.situacao === undefined && nfse?.numero) return 'emitido';
    return null;
  }

  async enviarNFSeParaPrefeitura(rpsIds: number[], automatico = false): Promise<any> {
    const resultados: any[] = [];
    let enviados = 0;
    for (const rpsId of [...new Set(rpsIds)]) {
      if (automatico && !await this.envioAutomaticoHabilitado()) break;
      const rps = await this.rpsService.buscarPorId(rpsId);
      if (!rps) { resultados.push({ rpsId, status: 'erro', mensagem: 'RPS não encontrado' }); continue; }
      // Automatic processing never retries errors or an uncertain previous submission.
      if (rps.status !== 'pendente' && (automatico || rps.status !== 'erro')) {
        resultados.push({ rpsId, status: 'ignorado', mensagem: 'RPS já enviado ou em processamento' }); continue;
      }
      if (!rps.nfseId) {
        await this.rpsService.atualizar(rpsId, { status: 'erro', mensagemErro: 'NFSe ID não encontrado. Revise este RPS.' });
        resultados.push({ rpsId, status: 'erro', mensagem: 'NFSe ID não encontrado' }); continue;
      }
      // Renew the token before claiming the row; authentication failures cannot strand the RPS.
      await this.ensureValidToken();
      if (!await this.rpsService.iniciarEnvio(rpsId, rps.status as 'pendente' | 'erro')) {
        resultados.push({ rpsId, status: 'ignorado', mensagem: 'RPS assumido por outro processamento' }); continue;
      }
      let envioIniciado = false;
      try {
        // Check the remote note before any POST (including explicit manual retries).
        const atual = await this.makeAuthenticatedRequest('/Api/v3/nfse/' + rps.nfseId);
        const situacao = this.situacaoNFSe(atual?.data);
        if (situacao === 'emitido') {
          await this.rpsService.atualizar(rpsId, { status: 'emitido', numeroNFSe: atual.data.numero || rps.numeroNFSe, mensagemErro: '' });
          enviados++;
          resultados.push({ rpsId, status: 'sucesso', mensagem: 'NFSe já emitida no Bling' }); continue;
        }
        if (situacao !== 'pendente') {
          const mensagem = situacao === 'erro' ? 'NFSe cancelada no Bling. Revise este RPS.' : 'Não foi possível confirmar a situação da NFSe. Revise este RPS.';
          await this.rpsService.atualizar(rpsId, { status: 'erro', mensagemErro: mensagem });
          resultados.push({ rpsId, status: 'erro', mensagem }); continue;
        }
        const dataEmissao = atual.data?.dataEmissao;
        const dataHoje = this.dataEmissaoHoje();
        if (typeof dataEmissao === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dataEmissao) && dataEmissao.slice(0, 10) > dataHoje) {
          const formatar = (data: string) => data.slice(0, 10).split('-').reverse().join('/');
          const mensagem = `Data de emissão futura no Bling: ${formatar(dataEmissao)}. Hoje em Brasília é ${formatar(dataHoje)}. Abra esta nota no Bling, revise a data de emissão e depois tente novamente. A alteração das configurações não atualiza notas já criadas.`;
          await this.rpsService.atualizar(rpsId, { status: 'erro', mensagemErro: mensagem });
          resultados.push({ rpsId, status: 'erro', mensagem });
          continue;
        }
        if (automatico && !await this.envioAutomaticoHabilitado()) {
          await this.rpsService.atualizarSeStatus(rpsId, 'processando', { status: rps.status, mensagemErro: rps.mensagemErro });
          break;
        }
        envioIniciado = true;
        const response = await this.makeAuthenticatedRequest('/Api/v3/nfse/' + rps.nfseId + '/enviar', { method: 'POST' });
        const resultStatus = this.situacaoNFSe(response?.data);
        const status = resultStatus === 'emitido' ? 'emitido' : resultStatus === 'erro' ? 'erro' : 'processando';
        await this.rpsService.atualizar(rpsId, {
          status, numeroNFSe: response?.data?.numero || rps.numeroNFSe,
          mensagemErro: status === 'erro' ? 'NFSe cancelada no Bling.' : '',
        });
        if (status === 'emitido') enviados++;
        resultados.push({ rpsId, status: status === 'emitido' ? 'sucesso' : status, mensagem: status === 'processando' ? 'Enviado; aguardando confirmação do Bling' : 'Situação da NFSe atualizada' });
      } catch (error) {
        // A timeout/5xx after POST may have reached the municipality. Reconcile, never resend automatically.
        const rejeitado = error instanceof BlingApiException && [400, 401, 403, 404, 422].includes(error.upstreamStatus);
        const status = envioIniciado ? (rejeitado ? 'erro' : 'processando') : (rejeitado ? 'erro' : rps.status);
        const mensagem = envioIniciado && !rejeitado
          ? 'Envio sem confirmação. Aguardando consulta ao Bling, sem reenviar: ' + error.message
          : error.message;
        await this.rpsService.atualizar(rpsId, { status, mensagemErro: mensagem });
        resultados.push({ rpsId, status, mensagem });
      }
    }
    return { success: true, enviados, total: rpsIds.length, resultados };
  }

  private async sincronizarRegistrosRPS(registros: Awaited<ReturnType<RpsService['listarParaAutomacao']>>, reconciliarExclusoes = false) {
    let atualizados = 0;
    let removidos = 0;
    let falhas = 0;
    for (const rps of registros) {
      if (!rps.nfseId) continue;
      try {
        const response = await this.makeAuthenticatedRequest('/Api/v3/nfse/' + rps.nfseId);
        const situacao = this.situacaoNFSe(response?.data);
        // Pending at Bling can mean the submission has not completed yet. Never requeue it.
        const status = situacao === 'emitido' || situacao === 'erro' ? situacao : rps.status;
        const changed = await this.rpsService.atualizarSeStatus(rps.id, rps.status, {
          status, numeroNFSe: response?.data?.numero || rps.numeroNFSe,
          mensagemErro: situacao === 'erro' ? 'NFSe cancelada no Bling.' : situacao === 'emitido' ? '' : rps.mensagemErro,
        });
        if (changed && (status !== rps.status || (response?.data?.numero && response.data.numero !== rps.numeroNFSe))) atualizados++;
      } catch (error) {
        if (reconciliarExclusoes && error instanceof BlingApiException && error.upstreamStatus === 404 && error.upstreamType === 'RESOURCE_NOT_FOUND') {
          if (await this.rpsService.removerExcluidoNoBling(rps)) {
            removidos++;
            continue;
          }
        }
        falhas++;
        // Preserve status on network/API failures and move this record to the end of the polling rotation.
        await this.rpsService.atualizarSeStatus(rps.id, rps.status, { mensagemErro: 'Não foi possível consultar o Bling: ' + error.message });
      }
    }
    return { success: true, verificados: registros.length, atualizados, removidos, falhas, corrigidos: 0 };
  }

  private readonly progressoMeta = new Map<number, RpsTargetProgress>();
  private progressoAtual() {
    const id = this.accountContext.account.id;
    if (!this.progressoMeta.has(id)) this.progressoMeta.set(id, novoProgressoMeta());
    return this.progressoMeta.get(id)!;
  }
  private registrarProgresso(changes: Partial<RpsTargetProgress>, message?: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const progress = this.progressoAtual();
    Object.assign(progress, changes, { updatedAt: new Date().toISOString() });
    if (message) progress.eventos = [{ at: progress.updatedAt, message, type }, ...progress.eventos].slice(0, 8);
    return progress;
  }

  private readonly candidatosMeta = new Map<number, { target: number; numeroInicial: number | null; pedidos: any[] }>();

  async configurarMetaRps(valor: unknown) {
    const target = Number(valor);
    if (!Number.isFinite(target) || target <= 0 || target > 9999999999.99 || Math.abs(Math.round(target * 100) - target * 100) > 0.000001) {
      throw new BadRequestException('Informe um valor-alvo válido com até duas casas decimais.');
    }
    const integracao = this.getIntegrationStatus();
    if (!integracao.isActive || !integracao.configured) throw new BadRequestException('Conecte a conta Bling antes de iniciar.');
    if (!this.accountContext.account.paymentMethodId) throw new BadRequestException('Configure a forma de pagamento antes de iniciar.');
    const valorGerado = await this.rpsService.obterValorGerado();
    const status = valorGerado > target ? 'concluida' : 'ativa';
    // Starting a generation target leaves dispatch under the queue controls.
    await this.blingIntegrationRepository.update({ id: this.accountContext.account.id }, {
      rpsTarget: target, rpsTargetStatus: status, rpsTargetMessage: null, autoRpsEnabled: false,
    });
    this.candidatosMeta.delete(this.accountContext.account.id);
    this.progressoMeta.set(this.accountContext.account.id, novoProgressoMeta());
    this.registrarProgresso({ stage: status === 'concluida' ? 'concluida' : 'preparando' }, status === 'concluida' ? 'O histórico já ultrapassa o alvo.' : 'Meta iniciada. Preparando a busca dos pedidos.');
    return { target, status };
  }

  async cancelarMetaRps() {
    this.candidatosMeta.delete(this.accountContext.account.id);
    await this.blingIntegrationRepository.update({ id: this.accountContext.account.id }, { rpsTargetStatus: 'pausada' });
    this.registrarProgresso({ stage: 'pausada', running: false, pedidoAtual: null }, 'Geração pausada pelo usuário.');
    return { status: 'pausada' };
  }

  async statusMetaRps() {
    const account = this.accountContext.account;
    const valorGerado = await this.rpsService.obterValorGerado();
    const progress = this.progressoMeta.get(account.id) ?? null;
    // The persisted checkpoint protects against duplicates after a restart. During a live
    // creation it must be presented as working rather than as a false review warning.
    const criando = account.rpsTargetStatus === 'revisao' && progress?.running && progress.stage === 'gerando';
    return { target: account.rpsTarget == null ? null : Number(account.rpsTarget),
      status: criando ? 'ativa' : account.rpsTargetStatus, message: criando ? null : account.rpsTargetMessage, valorGerado, progress,
      falhas: (account.rpsTargetFailures ?? []).filter(falha => !criando || falha.numeroPedido !== String(progress?.pedidoAtual)) };
  }

  private mensagemFalhaMeta(message: string): string {
    try {
      const start = message.indexOf('{');
      if (start >= 0) {
        const error = JSON.parse(message.slice(start)).error;
        const fields = Array.isArray(error?.fields) ? error.fields.map(field => field.msg || field.message).filter(Boolean) : [];
        return [error?.message, ...fields].filter(Boolean).join(' ') || message;
      }
    } catch { /* Keep the readable original for non-JSON failures. */ }
    return message;
  }

  private async registrarFalhaPedidoMeta(pedido: any, mensagem: string | null) {
    const account = this.accountContext.account;
    const falhas = (account.rpsTargetFailures ?? []).filter(item => item.pedidoId !== Number(pedido.id));
    if (mensagem) falhas.push({ pedidoId: Number(pedido.id), numeroPedido: String(pedido.numero), mensagem, at: new Date().toISOString() });
    await this.blingIntegrationRepository.update({ id: account.id }, { rpsTargetFailures: falhas });
    account.rpsTargetFailures = falhas;
  }

  private async atualizarMeta(status: string, message: string | null = null) {
    await this.blingIntegrationRepository.update({ id: this.accountContext.account.id }, { rpsTargetStatus: status, rpsTargetMessage: message });
    this.accountContext.account.rpsTargetStatus = status;
    if (status === 'concluida' || status === 'sem_pedidos') {
      this.candidatosMeta.delete(this.accountContext.account.id);
      this.registrarProgresso({ stage: status, pedidoAtual: null }, status === 'concluida' ? 'Alvo ultrapassado. Geração concluída.' : 'Busca concluída sem mais pedidos elegíveis.');
    }
  }

  async processarMetaRps() {
    if (this.accountContext.account.rpsTargetStatus !== 'ativa') return;
    this.registrarProgresso({ running: true, stage: 'aguardando' });
    try { await this.executarMetaRps(); }
    catch (error) {
      this.registrarProgresso({ stage: 'erro' }, 'Não foi possível continuar: ' + error.message, 'error');
      throw error;
    } finally { this.progressoAtual().running = false; }
  }

  private async executarMetaRps() {
    const account = this.accountContext.account;
    if (account.rpsTargetStatus !== 'ativa') return;
    const valorGerado = await this.rpsService.obterValorGerado();
    if (valorGerado > Number(account.rpsTarget)) { await this.atualizarMeta('concluida'); return; }
    let candidatos = this.candidatosMeta.get(account.id);
    if (!candidatos || candidatos.target !== Number(account.rpsTarget) || candidatos.numeroInicial !== account.initialOrderNumber) {
      this.registrarProgresso({ stage: 'buscando', paginas: 0, candidatos: 0 }, 'Buscando pedidos em todas as páginas.');
      const pedidos: any[] = [];
      const gerados = await this.rpsService.obterIdsPedidosGerados();
      const falhas = new Set((account.rpsTargetFailures ?? []).map(item => item.pedidoId));
      for (let pagina = 1; ; pagina++) {
        const response = await this.getPedidosVenda({ pagina, limite: 100 });
        if (!Array.isArray(response.data)) throw new Error('Resposta inválida ao buscar pedidos.');
        pedidos.push(...response.data.filter(pedido => pedido.id && pedido.data
          && Number(pedido.situacao?.id) !== 2
          && (!account.initialOrderNumber || Number(pedido.numero) >= account.initialOrderNumber)
          && !gerados.has(String(pedido.id)) && !falhas.has(Number(pedido.id))));
        this.registrarProgresso({ paginas: pagina, candidatos: pedidos.length });
        if (response.data.length < 100) break;
      }
      pedidos.sort((a, b) => String(a.data).localeCompare(String(b.data)) || Number(a.numero) - Number(b.numero));
      candidatos = { target: Number(account.rpsTarget), numeroInicial: account.initialOrderNumber, pedidos };
      this.candidatosMeta.set(account.id, candidatos);
      this.registrarProgresso({ stage: 'aguardando' }, `Busca concluída: ${pedidos.length} pedidos candidatos, dos mais antigos para os mais novos.`);
    }
    while (candidatos.pedidos.length) {
      const pedido = candidatos.pedidos.shift();
      this.registrarProgresso({ examinados: this.progressoAtual().examinados + 1, pedidoAtual: Number(pedido.numero) });
      // Other operations may have created this RPS since the initial scan.
      if (await this.rpsService.buscarPorPedidoId(pedido.id)) continue;
      this.registrarProgresso({ stage: 'gerando' }, `Preparando RPS do pedido #${pedido.numero}.`);
      // If the process stops during creation, require review rather than creating a duplicate.
      await this.registrarFalhaPedidoMeta(pedido, 'Criação sem confirmação. Confira este pedido no Bling antes de tentar novamente.');
      await this.atualizarMeta('revisao', 'Criação em andamento ou sem confirmação. Revise o pedido no Bling antes de reiniciar.');
      const result = await this.gerarRPSParaPedidos([pedido.id]);
      const item = result.resultados[0];
      if (item?.status === 'ignorado') {
        await this.registrarFalhaPedidoMeta(pedido, null);
        this.registrarProgresso({ ignorados: this.progressoAtual().ignorados + 1, stage: 'aguardando' }, `Pedido #${pedido.numero} ignorado: ${item.mensagem || 'não elegível'}.`, 'warning');
        await this.atualizarMeta('ativa'); continue;
      }
      if (item?.status !== 'sucesso') {
        const message = this.mensagemFalhaMeta(item?.mensagem || 'Falha ao criar RPS.');
        await this.registrarFalhaPedidoMeta(pedido, message);
        this.registrarProgresso({ stage: 'aguardando', erros: this.progressoAtual().erros + 1, pedidoAtual: null }, `Pedido #${pedido.numero}: ${message} Seguindo para o próximo.`, 'error');
        await this.atualizarMeta('ativa'); return;
      }
      await this.registrarFalhaPedidoMeta(pedido, null);
      const criado = await this.rpsService.buscarPorPedidoId(pedido.id);
      this.registrarProgresso({ stage: 'aguardando', gerados: this.progressoAtual().gerados + 1, pedidoAtual: null,
        ultimoRps: criado ? { pedido: criado.numeroPedido, numeroRps: criado.numeroRPS, valor: Number(criado.valorTotal), at: new Date().toISOString() } : null,
      }, `RPS gerado para o pedido #${pedido.numero}.`, 'success');
      const totalGerado = await this.rpsService.obterValorGerado();
      await this.atualizarMeta(totalGerado > Number(account.rpsTarget) ? 'concluida' : 'ativa');
      return;
    }
    this.candidatosMeta.delete(account.id);
    await this.atualizarMeta('sem_pedidos', 'Não há mais pedidos elegíveis.');
  }

  async resetarProcessamentoRps(id: number) {
    const rps = await this.rpsService.buscarPorId(id);
    if (!rps) throw new BadRequestException('RPS não encontrado nesta conta.');
    if (rps.status !== 'processando') return { status: rps.status, message: 'Este RPS já saiu do processamento. Atualizamos a lista.' };
    let status = 'erro';
    let message = 'Processamento resetado para revisão manual. O registro não possui ID da NFS-e no Bling.';
    if (rps.nfseId) {
      try {
        const response = await this.makeAuthenticatedRequest('/Api/v3/nfse/' + rps.nfseId);
        const situacao = this.situacaoNFSe(response?.data);
        if (situacao === 'emitido') {
          status = 'emitido';
          message = 'O Bling confirmou que a nota já foi emitida. Status atualizado.';
          const changed = await this.rpsService.atualizarSeStatus(id, 'processando', {
            status, numeroNFSe: response.data.numero || rps.numeroNFSe, mensagemErro: '',
          });
          return { status: changed ? status : (await this.rpsService.buscarPorId(id))?.status, message };
        }
        message = situacao === 'erro' ? 'Processamento resetado: nota cancelada no Bling. Revise o registro.'
          : 'Processamento resetado para revisão manual. O Bling ainda não confirmou a emissão. Confira o envio anterior antes de emitir novamente. Nenhum novo envio foi feito.';
      } catch (error) {
        if (!(error instanceof BlingApiException) || error.upstreamStatus !== 404 || error.upstreamType !== 'RESOURCE_NOT_FOUND') throw error;
        message = 'Processamento resetado para revisão manual: a nota não foi encontrada no Bling. Confira o ID e o histórico de emissão antes de tentar novamente.';
      }
    }
    // Keep the record and remove it from automatic dispatch. An uncertain previous
    // submission must never be returned to "pendente" and silently sent again.
    const changed = await this.rpsService.atualizarSeStatus(id, 'processando', { status, mensagemErro: message });
    return { status: changed ? status : (await this.rpsService.buscarPorId(id))?.status, message };
  }

  async processarFilaAutomatica() {
    await this.ensureValidToken();
    const processando = await this.rpsService.listarParaAutomacao('processando');
    await this.sincronizarRegistrosRPS(processando);
    if (!await this.envioAutomaticoHabilitado()) return { success: true, enviados: 0, total: 0, resultados: [] };
    const pendentes = await this.rpsService.listarParaAutomacao('pendente');
    return this.enviarNFSeParaPrefeitura(pendentes.map(rps => rps.id), true);
  }

  async sincronizarStatusNFSe(): Promise<any> {
    const registros: Awaited<ReturnType<RpsService['listarParaAutomacao']>> = [];
    // Collect all pages before reconciliation, so removals cannot shift page offsets.
    for (const status of ['pendente', 'erro', 'processando', 'emitido']) {
      for (let pagina = 1; ; pagina++) {
        const result = await this.rpsService.listarFila({ pagina, limite: 1000, status });
        registros.push(...result.data.filter(rps => status !== 'emitido' || !rps.numeroNFSe));
        if (!result.data.length || pagina * 1000 >= result.total) break;
      }
    }
    return this.sincronizarRegistrosRPS(registros, true);
  }
}
