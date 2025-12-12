import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlingIntegration } from './entities/bling-integration.entity';
import { RpsService } from './rps.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface BlingTokens {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token: string;
  expires_at?: number; // Timestamp de expiração calculado
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
  tokens_file: string;
  authorization_url: string;
  token_url: string;
  initial_order_number?: number | null;
}

@Injectable()
export class BlingService {
  private readonly logger = new Logger(BlingService.name);
  private readonly config: BlingConfig;
  private tokens: BlingTokens | null = null;

  // Códigos de serviços disponíveis
  private readonly codigosServico = {
    '85112': {
      codigo: '8.01',
      descricao: 'Prestação de serviços de Educação infantil - pré-escola',
      tipo: 'EDUCACAO_INFANTIL'
    },
    '85139': {
      codigo: '8.01.01',
      descricao: 'Prestação de serviços de educação - Ensino fundamental',
      tipo: 'ENSINO_FUNDAMENTAL'
    }
  };

  // Código de serviço padrão (pode ser alterado via configuração)
  private codigoServicoAtual = '85139';

  // Parcela atual (pode ser alterada via configuração)
  private parcelaAtual = Math.min(Math.max(new Date().getMonth() + 1, 1), 12);

  constructor(
    private configService: ConfigService,
    @InjectRepository(BlingIntegration)
    private readonly blingIntegrationRepository: Repository<BlingIntegration>,
    @Inject(forwardRef(() => RpsService))
    private readonly rpsService: RpsService,
  ) {
    this.config = {
      client_id: this.configService.get<string>('BLING_CLIENT_ID', 'e4d47370e5826618068d4d55eff5053cbba92402'),
      client_secret: this.configService.get<string>('BLING_CLIENT_SECRET', '9d1cc19d2b2f61509a6f1b30560dc73dd35cff'),
      redirect_uri: this.configService.get<string>('BLING_REDIRECT_URI', 'http://localhost:3000/bling/callback'),
      base_url: this.configService.get<string>('BLING_API_BASE_URL', 'https://api.bling.com.br'),
      tokens_file: this.configService.get<string>('TOKENS_FILE', './tokens.json'),
      authorization_url: this.configService.get<string>('BLING_AUTHORIZATION_URL', 'https://www.bling.com.br/Api/v3/oauth/authorize'),
      token_url: this.configService.get<string>('BLING_TOKEN_URL', 'https://www.bling.com.br/Api/v3/oauth/token')
    };

    // Tentar carregar credenciais salvas (sobrescreve env vars se existir)
    this.loadCredentials();

    // Carregar tokens existentes na inicialização
    this.loadTokens();
  }

  private getCredentialsPath(): string {
    return path.resolve(path.dirname(this.config.tokens_file), 'bling-config.json');
  }

  /**
   * Salva credenciais (Client ID e Secret)
   */
  saveCredentials(clientId: string, clientSecret: string): void {
    try {
      this.config.client_id = clientId;
      this.config.client_secret = clientSecret;

      const configPath = this.getCredentialsPath();
      const configDir = path.dirname(configPath);

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const existingCfg = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
        : {};

      const newCfg = {
        client_id: clientId,
        client_secret: clientSecret,
        initial_order_number: existingCfg.initial_order_number ?? null
      };

      fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2));

      this.logger.log(`Credenciais salvas em: ${configPath}`);
    } catch (error) {
      this.logger.error(`Erro ao salvar credenciais: ${error.message}`);
      throw new Error('Falha ao salvar credenciais');
    }
  }

  /**
   * Carrega credenciais do arquivo
   */
  private loadCredentials(): void {
    try {
      const configPath = this.getCredentialsPath();
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        const savedConfig = JSON.parse(configData);

        if (savedConfig.client_id && savedConfig.client_secret) {
          this.config.client_id = savedConfig.client_id;
          this.config.client_secret = savedConfig.client_secret;
          this.config.initial_order_number = typeof savedConfig.initial_order_number === 'number'
            ? savedConfig.initial_order_number
            : null;
          this.logger.log('Credenciais carregadas do arquivo de configuração');
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao carregar credenciais: ${error.message}`);
    }
  }

  /**
   * Remove credenciais salvas
   */
  removeCredentials(): void {
    try {
      const configPath = this.getCredentialsPath();
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        this.logger.log('Arquivo de credenciais removido');
      }

      // Reverter para env vars (ou valores padrão)
      this.config.client_id = this.configService.get<string>('BLING_CLIENT_ID', 'e4d47370e5826618068d4d55eff5053cbba92402');
      this.config.client_secret = this.configService.get<string>('BLING_CLIENT_SECRET', '9d1cc19d2b2f61509a6f1b30560dc73dd35cff');
      this.config.initial_order_number = null;

    } catch (error) {
      this.logger.error(`Erro ao remover credenciais: ${error.message}`);
    }
  }

  /**
   * Obtém status da integração
   */
  getIntegrationStatus(): any {
    const hasTokens = !!this.tokens;
    const now = Date.now();
    const expiresAt = this.tokens?.expires_at || 0;

    return {
      configured: !!(this.config.client_id && this.config.client_secret),
      isActive: hasTokens && now < expiresAt,
      clientId: this.config.client_id,
      hasClientSecret: !!this.config.client_secret,
      initialOrderNumber: this.config.initial_order_number ?? null,
      tokenExpiresAt: this.tokens?.expires_at ? new Date(this.tokens.expires_at).toISOString() : null,
      lastSyncAt: null // Implementar se houver sincronização
    };
  }

  /**
   * Define o número inicial do pedido de venda a sincronizar
   */
  setInitialOrderNumber(orderNumber: number | null): void {
    // Mantém suporte legacy baseado em arquivo para cenários não autenticados
    try {
      this.config.initial_order_number = orderNumber ?? null;
      const configPath = this.getCredentialsPath();
      const existingCfg = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
        : {};
      existingCfg.initial_order_number = this.config.initial_order_number;
      existingCfg.client_id = existingCfg.client_id ?? this.config.client_id;
      existingCfg.client_secret = existingCfg.client_secret ?? this.config.client_secret;
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(existingCfg, null, 2));
      this.logger.log(`Número inicial de pedido salvo (global): ${this.config.initial_order_number ?? 'null'}`);
    } catch (error) {
      this.logger.error(`Erro ao salvar número inicial global: ${error.message}`);
    }
  }

  async setInitialOrderNumberForUser(userId: string, orderNumber: number | null): Promise<void> {
    let integration = await this.blingIntegrationRepository.findOne({ where: { userId } });
    if (!integration) {
      // cria registro se não existir (sem tokens, apenas setting)
      integration = new BlingIntegration();
      integration.userId = userId;
      integration.accessToken = null;
      integration.refreshToken = null;
      integration.expiresAt = null;
      integration.isActive = false;
      integration.initialOrderNumber = orderNumber ?? null;
    } else {
      integration.initialOrderNumber = orderNumber ?? null;
    }
    await this.blingIntegrationRepository.save(integration);
    this.logger.log(`Número inicial de pedido salvo para userId=${userId}: ${integration.initialOrderNumber ?? 'null'}`);
  }

  async getInitialOrderNumberForUser(userId: string): Promise<number | null> {
    const integration = await this.blingIntegrationRepository.findOne({ where: { userId } });
    return integration?.initialOrderNumber ?? null;
  }

  /**
   * Gera URL de autorização OAuth2 para o usuário
   */
  generateAuthorizationUrl(): string {
    const state = crypto.randomBytes(16).toString('hex');

    // Salvar state para verificação posterior (em produção, usar Redis ou banco)
    this.saveState(state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.client_id,
      state: state
    });

    const authUrl = `${this.config.authorization_url}?${params.toString()}`;

    this.logger.log(`URL de autorização gerada: ${authUrl}`);
    return authUrl;
  }

  /**
   * Troca authorization code por tokens de acesso
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<BlingTokens> {
    try {
      // Verificar state para segurança
      if (!this.verifyState(state)) {
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
      this.saveTokens(tokens);

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
      this.saveTokens(newTokens);

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

    return this.tokens.access_token;
  }

  /**
   * Faz requisição autenticada para API do Bling
   */
  async makeAuthenticatedRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
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

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const responseText = await response.text();
    console.log('=== RESPOSTA BLING ===');
    console.log('Status:', response.status);
    console.log('Response:', responseText);
    console.log('======================');

    if (!response.ok) {
      this.logger.error(`Erro na requisição Bling: ${response.status} - ${responseText}`);
      throw new BadRequestException(`Erro na API Bling: ${response.status} - ${responseText}`);
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
  setTokens(tokens: BlingTokens): void {
    if (!tokens.expires_at) {
      tokens.expires_at = Date.now() + (tokens.expires_in * 1000);
    }
    this.tokens = tokens;
    this.logger.log('Tokens definidos manualmente');
  }

  /**
   * Remove tokens (logout)
   */
  clearTokens(): void {
    this.tokens = null;
    this.logger.log('Tokens removidos');

    // Remover arquivo de tokens
    this.deleteTokensFile();
  }

  /**
   * Carrega tokens do arquivo de configuração
   */
  private loadTokens(): void {
    try {
      const tokensPath = path.resolve(this.config.tokens_file);
      if (fs.existsSync(tokensPath)) {
        const tokensData = fs.readFileSync(tokensPath, 'utf8');
        const tokens: BlingTokens = JSON.parse(tokensData);

        // Verificar se os tokens não expiraram
        const now = Date.now();
        if (tokens.expires_at && now < tokens.expires_at) {
          this.tokens = tokens;
          this.logger.log('Tokens carregados do arquivo');
        } else {
          this.logger.log('Tokens expirados encontrados no arquivo');
          this.deleteTokensFile();
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao carregar tokens: ${error.message}`);
    }
  }

  /**
   * Salva tokens no arquivo de configuração
   */
  private saveTokens(tokens: BlingTokens): void {
    try {
      const tokensPath = path.resolve(this.config.tokens_file);
      const tokensDir = path.dirname(tokensPath);

      // Criar diretório se não existir
      if (!fs.existsSync(tokensDir)) {
        fs.mkdirSync(tokensDir, { recursive: true });
      }

      fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
      this.logger.log(`Tokens salvos em: ${tokensPath}`);
    } catch (error) {
      this.logger.error(`Erro ao salvar tokens: ${error.message}`);
    }
  }

  /**
   * Remove arquivo de tokens
   */
  private deleteTokensFile(): void {
    try {
      const tokensPath = path.resolve(this.config.tokens_file);
      if (fs.existsSync(tokensPath)) {
        fs.unlinkSync(tokensPath);
        this.logger.log('Arquivo de tokens removido');
      }
    } catch (error) {
      this.logger.error(`Erro ao remover arquivo de tokens: ${error.message}`);
    }
  }

  // Métodos auxiliares para gerenciar state (em produção, usar Redis)
  private states: Set<string> = new Set();

  private saveState(state: string): void {
    this.states.add(state);
    // Remove state após 10 minutos
    setTimeout(() => this.states.delete(state), 10 * 60 * 1000);
  }

  private verifyState(state: string): boolean {
    const isValid = this.states.has(state);
    if (isValid) {
      this.states.delete(state); // Use apenas uma vez
    }
    return isValid;
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

      const response = await fetch(
        `${apiUrl}/contatos/${id}`,
        {
          method: 'GET',
          headers: {
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

    const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

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

      // Serviços (obrigatório) - CÓDIGO DINÂMICO BASEADO NA CONFIGURAÇÃO
      servicos: [{
        codigo: this.codigosServico[this.codigoServicoAtual].codigo,
        descricao: `${this.codigosServico[this.codigoServicoAtual].descricao} - PARCELA ${parcelaParaUsar} - Aluno: ${duplicata.nomeAluno} - Turma: ${duplicata.turma}`,
        valor: valor
      }],

      // Parcelas (opcional) - formato exato da documentação
      parcelas: [{
        data: currentDate,
        valor: valor,
        observacoes: `PARCELA ${parcelaParaUsar} - Referente aos serviços educacionais do aluno ${duplicata.nomeAluno}`,
        formaPagamento: {
          id: 1 // ID da forma de pagamento
        }
      }]
    };
  }

  /**
   * Configurar código de serviço a ser usado nas NFSe
   */
  configurarCodigoServico(codigo: string): boolean {
    if (!this.codigosServico[codigo]) {
      this.logger.error(`Código de serviço inválido: ${codigo}`);
      return false;
    }

    this.codigoServicoAtual = codigo;
    this.logger.log(`Código de serviço configurado para: ${codigo} - ${this.codigosServico[codigo].descricao}`);
    return true;
  }

  /**
   * Configurar parcela a ser usada nas NFSe
   */
  configurarParcela(parcela: number): boolean {
    if (!Number.isInteger(parcela) || parcela < 1 || parcela > 12) {
      this.logger.error(`Número de parcela inválido: ${parcela}. Deve ser entre 1 e 12.`);
      return false;
    }

    this.parcelaAtual = parcela;
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

      const response = await fetch(url, {
        method: 'GET',
        headers: {
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
  async obterFormasPagamento(): Promise<any[]> {
    try {
      const response = await this.makeAuthenticatedRequest(`/Api/v3/formas-pagamentos`);
      return response.data || [];
    } catch (error) {
      this.logger.error(`Erro ao obter formas de pagamento: ${error.message}`);
      return [];
    }
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
    
    const dataHoje = new Date().toISOString().split('T')[0];

    // Payload baseado na documentação oficial do Bling API v3
    // POST /nfse - NotasServicosDadosBaseDTO_POST + NotasServicosDadosDTO_POST
    const payload: any = {
      // Campos de NotasServicosDadosBase (obrigatórios: numeroRPS, serie, contato)
      numeroRPS: numeroRPS,
      serie: "1",
      
      // Campos de NotasServicosDadosDTO_POST
      data: dataHoje,
      baseCalculo: valorTotal,
      reterISS: false,
      desconto: 0,
      
      // Contato - NotasServicosContatoBaseDTO (obrigatórios: id, nome, numeroDocumento, email)
      // + NotasServicosContatoDTO (opcionais: ie, telefone, im, endereco)
      contato: {
        id: contato.id,
        nome: contato.nome,
        numeroDocumento: contato.numeroDocumento || contato.cpfCnpj || "",
        email: contato.email || "naotem@email.com"
      },
      
      // Serviços - NotasServicosServicoDTO (obrigatórios: codigo, descricao, valor)
      servicos: servicos.map(s => ({
        codigo: "5.08", // Código de serviço LC 116
        descricao: s.descricao,
        valor: parseFloat(s.valor || 0)
      })),
      
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

        // 7. Forma de pagamento fixa: Dinheiro (id: 2222749)
        const formaPagamentoId = 2222749;

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

  /**
   * Enviar NFSe para a prefeitura (POST /nfse/{id}/enviar)
   */
  async enviarNFSeParaPrefeitura(rpsIds: number[]): Promise<any> {
    this.logger.log(`Iniciando envio de ${rpsIds.length} NFSe para prefeitura...`);
    
    const resultados: any[] = [];
    let enviados = 0;

    for (const rpsId of rpsIds) {
      let rps: any = null;
      
      try {
        // Buscar RPS no banco
        rps = await this.rpsService.buscarPorId(rpsId);
        if (!rps) {
          resultados.push({ rpsId, status: 'erro', mensagem: 'RPS não encontrado' });
          continue;
        }

        if (!rps.nfseId) {
          resultados.push({ rpsId, status: 'erro', mensagem: 'NFSe ID não encontrado' });
          continue;
        }

        // Atualizar status para processando
        await this.rpsService.atualizar(rpsId, { status: 'processando' });

        // Enviar para prefeitura
        this.logger.log(`Enviando NFSe ${rps.nfseId} para prefeitura...`);
        const response = await this.makeAuthenticatedRequest(`/Api/v3/nfse/${rps.nfseId}/enviar`, {
          method: 'POST'
        });

        // Verificar resposta e atualizar status
        if (response?.data?.numero) {
          // NFSe emitida com sucesso
          await this.rpsService.atualizar(rpsId, { 
            status: 'emitido',
            numeroNFSe: response.data.numero
          });
          enviados++;
          resultados.push({ 
            rpsId, 
            status: 'sucesso', 
            numeroNFSe: response.data.numero,
            mensagem: 'NFSe emitida com sucesso' 
          });
        } else {
          // Atualizar como processando (aguardando retorno da prefeitura)
          resultados.push({ 
            rpsId, 
            status: 'processando', 
            mensagem: 'Enviado para prefeitura, aguardando retorno' 
          });
        }

      } catch (error) {
        this.logger.error(`Erro ao enviar NFSe do RPS ${rpsId}: ${error.message}`);
        
        // Para qualquer erro, verificar se a NFSe já está emitida no Bling
        if (rps?.nfseId) {
          try {
            this.logger.log(`Verificando status da NFSe ${rps.nfseId} no Bling...`);
            const nfseData = await this.makeAuthenticatedRequest(`/Api/v3/nfse/${rps.nfseId}`, { method: 'GET' });
            
            // situacao: 1 = Pendente, 2 = Emitida, 3 = Cancelada, 4 = Erro
            if (nfseData?.data?.situacao === 2 || nfseData?.data?.numero) {
              this.logger.log(`NFSe ${rps.nfseId} já está emitida com número ${nfseData?.data?.numero}`);
              await this.rpsService.atualizar(rpsId, { 
                status: 'emitido',
                numeroNFSe: nfseData.data.numero || null
              });
              resultados.push({ 
                rpsId, 
                status: 'sucesso', 
                numeroNFSe: nfseData.data.numero, 
                mensagem: 'NFSe já estava emitida no Bling' 
              });
              enviados++;
              continue;
            }
          } catch (e) {
            this.logger.warn(`Não foi possível verificar status da NFSe: ${e.message}`);
          }
        }
        
        // Se não conseguiu verificar ou não está emitida, marca como erro
        await this.rpsService.atualizar(rpsId, { 
          status: 'erro', 
          mensagemErro: error.message 
        });
        resultados.push({ rpsId, status: 'erro', mensagem: error.message });
      }
    }

    return {
      success: true,
      enviados,
      total: rpsIds.length,
      resultados
    };
  }

  /**
   * Sincronizar status das NFSe com o Bling
   */
  async sincronizarStatusNFSe(): Promise<any> {
    this.logger.log('Iniciando sincronização de status das NFSe...');

    try {
      // Buscar RPS pendentes, processando e emitidos sem número de nota
      const { data: rpsPendentes } = await this.rpsService.listarFila({ 
        pagina: 1, 
        limite: 1000,
        status: 'pendente'
      });

      const { data: rpsProcessando } = await this.rpsService.listarFila({ 
        pagina: 1, 
        limite: 1000,
        status: 'processando'
      });

      // Buscar também os emitidos para verificar se têm número de nota
      const { data: rpsEmitidos } = await this.rpsService.listarFila({ 
        pagina: 1, 
        limite: 1000,
        status: 'emitido'
      });

      // Filtrar emitidos sem número de nota
      const emitidosSemNumero = rpsEmitidos.filter((rps: any) => !rps.numeroNFSe);
      this.logger.log(`Encontrados ${emitidosSemNumero.length} registros emitidos sem número de nota`);

      const rpsParaVerificar = [...rpsPendentes, ...rpsProcessando, ...emitidosSemNumero];
      let atualizados = 0;
      let corrigidos = 0;

      for (const rps of rpsParaVerificar) {
        if (!rps.nfseId) continue;

        try {
          // Buscar NFSe no Bling
          const response = await this.makeAuthenticatedRequest(`/Api/v3/nfse/${rps.nfseId}`);
          
          if (response?.data) {
            const nfse = response.data;
            
            // Situação: 0=Pendente, 1=Emitida, 2=Disponível, 3=Cancelada
            let novoStatus = rps.status;
            
            if (nfse.situacao === 1 || nfse.situacao === 2) {
              novoStatus = 'emitido';
            } else if (nfse.situacao === 3) {
              novoStatus = 'erro';
            } else if (nfse.situacao === 0) {
              novoStatus = 'pendente';
            }

            // Se status mudou ou se precisa atualizar número da nota
            const precisaAtualizar = novoStatus !== rps.status || 
                                     (nfse.numero && nfse.numero !== rps.numeroNFSe);

            if (precisaAtualizar) {
              await this.rpsService.atualizar(rps.id, { 
                status: novoStatus,
                numeroNFSe: nfse.numero || rps.numeroNFSe
              });
              
              if (rps.status === 'emitido' && !rps.numeroNFSe && nfse.numero) {
                corrigidos++;
                this.logger.log(`✅ Corrigido RPS ${rps.id}: adicionado número ${nfse.numero}`);
              } else {
                atualizados++;
              }
            }
          }
        } catch (error) {
          this.logger.warn(`Erro ao verificar NFSe ${rps.nfseId}: ${error.message}`);
          
          // Se não encontrou a NFSe no Bling, e status é emitido sem número, volta para pendente
          if (rps.status === 'emitido' && !rps.numeroNFSe) {
            await this.rpsService.atualizar(rps.id, { 
              status: 'pendente',
              mensagemErro: 'NFSe não encontrada no Bling - status resetado'
            });
            corrigidos++;
            this.logger.log(`⚠️ RPS ${rps.id} resetado para pendente - NFSe não encontrada`);
          }
        }
      }

      this.logger.log(`✅ Sincronização concluída: ${atualizados} atualizados, ${corrigidos} corrigidos`);

      return {
        success: true,
        verificados: rpsParaVerificar.length,
        atualizados,
        corrigidos
      };

    } catch (error) {
      this.logger.error(`Erro na sincronização: ${error.message}`);
      throw error;
    }
  }
}
