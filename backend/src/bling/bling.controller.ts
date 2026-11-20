import { RpsWorkerService } from './rps-worker.service';
import { AccountInterceptor } from './account.interceptor';
import { LocalAccountRead } from './local-account-read.decorator';
import { Controller, Get, Post, Delete, Query, Body, Param, Logger, BadRequestException, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BlingService } from './bling.service';
import { RpsService } from './rps.service';

@Controller('bling')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AccountInterceptor)
export class BlingController {
  private readonly logger = new Logger(BlingController.name);

  constructor(
    private readonly blingService: BlingService,
    private readonly rpsService: RpsService,
    private readonly rpsWorker: RpsWorkerService,
  ) { }

  /**
   * Obtém status da integração
   * GET /bling/integration
   */
  @Get('fila-rps/automacao')
  @LocalAccountRead()
  getAutomationStatus() {
    const worker = this.rpsWorker.getStatus();
    const account = this.blingService.getIntegrationStatus();
    return { ...worker, globalEnabled: worker.enabled, accountEnabled: account.autoRpsEnabled,
      enabled: worker.enabled && account.autoRpsEnabled, connected: account.isActive };
  }

  @Get('meta-rps')
  @LocalAccountRead()
  statusMetaRps() { return this.blingService.statusMetaRps(); }

  @Post('meta-rps')
  configurarMetaRps(@Body() body: { valor: number }) {
    if (!this.rpsWorker.getStatus().enabled) throw new BadRequestException('A automação está desativada no servidor.');
    return this.blingService.configurarMetaRps(body.valor);
  }

  @Post('meta-rps/pausar')
  pausarMetaRps() { return this.blingService.cancelarMetaRps(); }

  @Get('integration')
  getIntegrationStatus() { return this.blingService.getIntegrationStatus(); }

  @Get('formas-pagamentos')
  async getFormasPagamento() {
    return { data: await this.blingService.obterFormasPagamento() };
  }

  @Post('integration')
  async saveIntegration(@Body() body: { clientId: string; clientSecret?: string; initialOrderNumber?: number | null; paymentMethodId?: string | null }) {
    await this.blingService.saveCredentials(body.clientId, body.clientSecret, body.initialOrderNumber, body.paymentMethodId);
    return { message: 'Configuração salva com sucesso', ...this.blingService.getIntegrationStatus() };
  }

  /**
   * Atualiza apenas o número inicial de pedido
   * POST /bling/integration/initial-order
   */
  @UseGuards(JwtAuthGuard)
  @Post('integration/initial-order')
  async setInitialOrder(@Request() req: any, @Body() body: { initialOrderNumber: number | null }) {
    try {
      const value = body.initialOrderNumber === null ? null : Number(body.initialOrderNumber);
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new BadRequestException('initialOrderNumber deve ser um número inteiro positivo ou null');
      }
      const userId = req.user?.id;
      if (!userId) {
        throw new BadRequestException('Usuário inválido');
      }
      await this.blingService.setInitialOrderNumber(value);
      return { message: 'Número inicial atualizado com sucesso', initialOrderNumber: value };
    } catch (error) {
      this.logger.error(`Erro ao atualizar número inicial: ${error.message}`);
      throw new BadRequestException(`Erro ao atualizar número inicial: ${error.message}`);
    }
  }

  /**
   * Remove integração completa
   * DELETE /bling/integration
   */
  @Delete('integration')
  async removeIntegration() {
    try {
      await this.blingService.removeCredentials();

      return {
        message: 'Integração removida com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao remover integração: ${error.message}`);
      throw new BadRequestException(`Erro ao remover integração: ${error.message}`);
    }
  }

  /**
   * Inicia processo de autenticação OAuth2
   * GET /bling/authorize
   */
  @Get('authorize')
  async startAuthentication() {
    return { authorizationUrl: await this.blingService.generateAuthorizationUrl() };
  }

  /**
   * Desativa integração (remove tokens)
   * POST /bling/deactivate
   */
  @Post('deactivate')
  async deactivateIntegration() {
    try {
      await this.blingService.clearTokens();

      return {
        message: 'Integração desativada com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao desativar integração: ${error.message}`);
      throw new BadRequestException(`Erro ao desativar integração: ${error.message}`);
    }
  }

  /**
   * Obtém status da autenticação
   * GET /bling/status
   */
  @Get('status')
  getAuthStatus() {
    try {
      const tokenInfo = this.blingService.getTokenInfo();

      return {
        success: true,
        ...tokenInfo
      };
    } catch (error) {
      this.logger.error(`Erro ao obter status: ${error.message}`);
      return {
        success: false,
        authenticated: false,
        error: error.message
      };
    }
  }

  /**
   * Testa conexão com API Bling
   * POST /bling/test
   */
  @Post('test')
  async testConnection() {
    try {
      const result = await this.blingService.testConnection();

      this.logger.log(`Teste de conexão: ${result.success ? 'OK' : 'FALHA'}`);
      return result;
    } catch (error) {
      this.logger.error(`Erro ao testar conexão: ${error.message}`);
      return {
        success: false,
        message: `Erro interno: ${error.message}`
      };
    }
  }

  /**
   * Renova token manualmente
   * POST /bling/refresh
   */
  @Post('refresh')
  async refreshToken() {
    try {
      const newTokens = await this.blingService.refreshAccessToken();

      this.logger.log('Token renovado manualmente');
      return {
        success: true,
        message: 'Token renovado com sucesso',
        expires_in: newTokens.expires_in
      };
    } catch (error) {
      this.logger.error(`Erro ao renovar token: ${error.message}`);
      throw new BadRequestException(`Erro ao renovar token: ${error.message}`);
    }
  }

  /**
   * Remove autenticação (logout)
   * POST /bling/logout
   */
  @Post('logout')
  async logout() {
    try {
      await this.blingService.clearTokens();

      this.logger.log('Logout realizado');
      return {
        success: true,
        message: 'Logout realizado com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro no logout: ${error.message}`);
      throw new BadRequestException(`Erro no logout: ${error.message}`);
    }
  }

  /**
   * Endpoint para configuração manual de tokens (para desenvolvimento/testes)
   * POST /bling/set-tokens
   */
  @Post('set-tokens')
  async setTokens(@Body() body: any) {
    try {
      if (!body.access_token || !body.refresh_token) {
        throw new BadRequestException('access_token e refresh_token são obrigatórios');
      }

      await this.blingService.setTokens(body);

      this.logger.log('Tokens definidos manualmente');
      return {
        success: true,
        message: 'Tokens configurados com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao definir tokens: ${error.message}`);
      throw new BadRequestException(`Erro ao definir tokens: ${error.message}`);
    }
  }

  /**
   * Faz uma requisição de exemplo para API Bling
   * GET /bling/contatos
   */
  @Get('contatos')
  async getContatos(@Query('limite') limite: string = '10') {
    try {
      const result = await this.blingService.makeAuthenticatedRequest(
        `/contatos?limite=${limite}`
      );

      return {
        success: true,
        data: result
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar contatos: ${error.message}`);
      throw new BadRequestException(`Erro ao buscar contatos: ${error.message}`);
    }
  }

  /**
   * Testa busca de contato por CPF
   * GET /bling/contatos/buscar-cpf/:cpf
   */
  @Get('contatos/buscar-cpf/:cpf')
  async buscarContatoPorCPF(@Param('cpf') cpf: string) {
    try {
      const cpfLimpo = cpf.replace(/\D/g, '');

      const contato = await this.blingService.buscarContatoPorCPF(cpfLimpo);

      return {
        success: true,
        cpf: cpfLimpo,
        encontrado: !!contato,
        contato: contato
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar contato por CPF: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obtém detalhes completos de um contato
   * GET /bling/contatos/detalhes/:id
   */
  @Get('contatos/detalhes/:id')
  async obterDetalhesContato(@Param('id') id: string) {
    try {
      const detalhes = await this.blingService.obterDetalhesContato(parseInt(id));

      return {
        success: true,
        contato: detalhes
      };
    } catch (error) {
      this.logger.error(`Erro ao obter detalhes do contato: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter códigos de serviço disponíveis
   * GET /bling/codigos-servico
   */
  @Get('codigos-servico')
  async obterCodigosServico() {
    try {
      const codigos = this.blingService.obterCodigosServico();

      return {
        success: true,
        codigos
      };
    } catch (error) {
      this.logger.error(`Erro ao obter códigos de serviço: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Configurar código de serviço para NFSe
   * POST /bling/configurar-servico
   */
  @Post('configurar-servico')
  async configurarCodigoServico(@Body() data: { codigo: string, parcela?: number }) {
    try {
      const sucesso = await this.blingService.configurarCodigoServico(data.codigo);

      if (!sucesso) {
        return {
          success: false,
          message: 'Código de serviço inválido'
        };
      }

      if (data.parcela !== undefined) {
        const sucessoParcela = await this.blingService.configurarParcela(data.parcela);
        if (!sucessoParcela) {
          return {
            success: false,
            message: 'Número de parcela inválido'
          };
        }
      }

      return {
        success: true,
        message: 'Configurações atualizadas com sucesso',
        codigoAtual: data.codigo,
        parcelaAtual: data.parcela || this.blingService.obterParcelaAtual()
      };
    } catch (error) {
      this.logger.error(`Erro ao configurar código de serviço: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Configurar apenas a parcela
   * POST /bling/configurar-parcela
   */
  @Post('configurar-parcela')
  async configurarParcela(@Body() data: { parcela: number }) {
    try {
      const sucesso = await this.blingService.configurarParcela(data.parcela);

      if (!sucesso) {
        return {
          success: false,
          message: 'Número de parcela inválido. Deve ser entre 1 e 12.'
        };
      }

      return {
        success: true,
        message: `Parcela configurada para: ${data.parcela}`,
        parcelaAtual: data.parcela
      };
    } catch (error) {
      this.logger.error(`Erro ao configurar parcela: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Buscar configurações de NFSe do Bling
   * GET /bling/configuracoes-nfse
   */
  @Get('configuracoes-nfse')
  async buscarConfiguracoesNFSe() {
    try {
      const configuracoes = await this.blingService.buscarConfiguracoesNFSe();

      return {
        success: true,
        configuracoes: configuracoes
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar configurações NFSe: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Lista pedidos de venda do Bling
   * GET /bling/pedidos-venda
   */
  @UseGuards(JwtAuthGuard)
  @Get('pedidos-venda')
  async getPedidosVenda(
    @Query('pagina') pagina: string = '1',
    @Query('limite') limite: string = '20',
    @Query('numero') numero?: string,
    @Query('dataInicial') dataInicial?: string,
    @Query('dataFinal') dataFinal?: string,
    @Query('idContato') idContato?: string,
    @Query('idsSituacoes[]') idsSituacoes?: string[]
  ) {
    try {
      const params: any = {
        pagina: parseInt(pagina || '1') || 1,
        limite: parseInt(limite || '20') || 20,
      };

      if (numero) params.numero = parseInt(numero);
      if (dataInicial) params.dataInicial = dataInicial;
      if (dataFinal) params.dataFinal = dataFinal;
      if (idContato) params.idContato = parseInt(idContato);
      if (idsSituacoes && idsSituacoes.length > 0) {
        params.idsSituacoes = idsSituacoes.map(id => parseInt(id));
      }

      const result = await this.blingService.getPedidosVenda(params);

      // Enriquecer com dados de RPS
      if (result.data && Array.isArray(result.data)) {
        const pedidosComRPS = await Promise.all(
          result.data.map(async (pedido: any) => {
            const rps = await this.rpsService.buscarPorPedidoId(pedido.id);
            if (rps) {
              return {
                ...pedido,
                rpsStatus: rps.status,
                numeroRPS: rps.numeroRPS,
                numeroNFSe: rps.numeroNFSe,
              };
            }
            return pedido;
          })
        );

        return {
          ...result,
          data: pedidosComRPS,
        };
      }

      return result;
    } catch (error) {
      this.logger.error(`Erro ao buscar pedidos de venda: ${error.message}`);
      throw new BadRequestException(`Erro ao buscar pedidos de venda: ${error.message}`);
    }
  }

  /**
   * =====================================================
   * ENDPOINTS RPS
   * =====================================================
   */

  /**
   * Gerar RPS para pedidos de venda selecionados
   * POST /bling/gerar-rps
   */
  @UseGuards(JwtAuthGuard)
  @Post('gerar-rps')
  async gerarRPS(@Body() body: { pedidoIds: number[] }) {
    try {
      console.log('🔵 [Controller gerar-rps] Body recebido:', JSON.stringify(body, null, 2));

      if (!body.pedidoIds || !Array.isArray(body.pedidoIds) || body.pedidoIds.length === 0) {
        console.log('🔴 [Controller gerar-rps] Erro: pedidoIds inválido');
        throw new BadRequestException('pedidoIds deve ser um array com ao menos um ID');
      }

      this.logger.log(`Recebida solicitação para gerar RPS de ${body.pedidoIds.length} pedidos`);
      console.log('🔵 [Controller gerar-rps] Chamando service.gerarRPSParaPedidos...');

      const resultado = await this.blingService.gerarRPSParaPedidos(body.pedidoIds);

      console.log('🟢 [Controller gerar-rps] Resultado:', JSON.stringify(resultado, null, 2));

      return resultado;
    } catch (error) {
      console.log('🔴 [Controller gerar-rps] Erro:', error.message);
      this.logger.error(`Erro ao gerar RPS: ${error.message}`);
      throw new BadRequestException(`Erro ao gerar RPS: ${error.message}`);
    }
  }

  /**
   * Obter fila de RPS com filtros e paginação
   * GET /bling/fila-rps
   */
  @UseGuards(JwtAuthGuard)
  @Get('fila-rps')
  @LocalAccountRead()
  async getFilaRPS(
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
    @Query('status') status?: string,
  ) {
    try {
      const params: any = {
        pagina: parseInt(pagina || '1') || 1,
        limite: parseInt(limite || '20') || 20,
      };

      if (status) {
        params.status = status;
      }

      const { data, total } = await this.rpsService.listarFila(params);

      const totalPaginas = Math.ceil(total / params.limite);

      return {
        data,
        total,
        pagina: params.pagina,
        totalPaginas,
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar fila de RPS: ${error.message}`);
      throw new BadRequestException(`Erro ao buscar fila de RPS: ${error.message}`);
    }
  }

  /**
   * Obter detalhes de um pedido de venda
   * GET /bling/pedidos-venda/:id/detalhes
   */
  @UseGuards(JwtAuthGuard)
  @Get('pedidos-venda/:id/detalhes')
  async getPedidoDetalhes(@Param('id') id: string) {
    try {
      const pedidoId = parseInt(id);
      if (isNaN(pedidoId)) {
        throw new BadRequestException('ID do pedido inválido');
      }

      const detalhes = await this.blingService.obterDetalhesPedidoVenda(pedidoId);

      return detalhes;
    } catch (error) {
      this.logger.error(`Erro ao buscar detalhes do pedido: ${error.message}`);
      throw new BadRequestException(`Erro ao buscar detalhes do pedido: ${error.message}`);
    }
  }

  /**
   * Obter estatísticas da fila de RPS
   * GET /bling/fila-rps/estatisticas
   */
  @UseGuards(JwtAuthGuard)
  @Get('fila-rps/estatisticas')
  @LocalAccountRead()
  async getEstatisticasRPS() {
    try {
      const estatisticas = await this.rpsService.obterEstatisticas();

      return estatisticas;
    } catch (error) {
      this.logger.error(`Erro ao buscar estatísticas de RPS: ${error.message}`);
      throw new BadRequestException(`Erro ao buscar estatísticas de RPS: ${error.message}`);
    }
  }

  /**
   * Enviar NFSe selecionadas para a prefeitura
   * POST /bling/enviar-nfse
   */
  @UseGuards(JwtAuthGuard)
  @Post('enviar-nfse')
  async enviarNFSe(@Body() body: { rpsIds: number[] }) {
    try {
      if (!body.rpsIds || !Array.isArray(body.rpsIds) || body.rpsIds.length === 0) {
        throw new BadRequestException('rpsIds deve ser um array com ao menos um ID');
      }

      const resultado = await this.blingService.enviarNFSeParaPrefeitura(body.rpsIds);
      return resultado;
    } catch (error) {
      this.logger.error(`Erro ao enviar NFSe: ${error.message}`);
      throw new BadRequestException(`Erro ao enviar NFSe: ${error.message}`);
    }
  }

  /**
   * Sincronizar status das NFSe com o Bling
   * POST /bling/sincronizar-nfse
   */
  @UseGuards(JwtAuthGuard)
  @Post('sincronizar-nfse')
  async sincronizarNFSe() {
    try {
      const resultado = await this.blingService.sincronizarStatusNFSe();
      return resultado;
    } catch (error) {
      this.logger.error(`Erro ao sincronizar NFSe: ${error.message}`);
      throw new BadRequestException(`Erro ao sincronizar NFSe: ${error.message}`);
    }
  }

  @Post('fila-rps/:id/resetar')
  async resetarProcessamentoRps(@Param('id') id: string) {
    const rpsId = Number(id);
    if (!Number.isSafeInteger(rpsId) || rpsId <= 0) throw new BadRequestException('RPS inválido.');
    try { return await this.blingService.resetarProcessamentoRps(rpsId); }
    catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Não foi possível confirmar a situação no Bling. O status em processamento foi preservado. Tente novamente em instantes.');
    }
  }
}
