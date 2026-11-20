import {
  BadRequestException, BadGatewayException, ForbiddenException,
  Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { AccountsService } from '../../bling/accounts.service';
import { BlingApiException, BlingService } from '../../bling/bling.service';

type Fields = Record<string, unknown>;
type Direction = 'pagar' | 'receber';
type DateBasis = 'vencimento' | 'emissao' | 'liquidacao';

const accountId = { type: 'integer', minimum: 1, description: 'ID da conta Office autorizado.' };
const entryId = { type: 'integer', minimum: 1, description: 'ID retornado pelo Bling.' };
const paging = {
  pagina: { type: 'integer', minimum: 1, default: 1 },
  limite: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
};
const date = { type: 'string', format: 'date', description: 'Data YYYY-MM-DD.' };

function tool(name: string, description: string, properties: Fields = {}, required: string[] = []) {
  return {
    name, description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

const listFields = {
  accountId, inicio: date, fim: date,
  base: { type: 'string', enum: ['vencimento', 'emissao', 'liquidacao'], default: 'vencimento' },
  situacao: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1 Aberto, 2 Pago/recebido, 3 Parcial, 4 Devolvido, 5 Cancelado. Omitir para buscar todas.' },
  ...paging,
};

export const financeTools = [
  tool('finance_list_accounts', 'Lista as contas Bling autorizadas para este MCP.'),
  tool('finance_list_payables', 'Lista títulos a pagar para um período de até 366 dias. Faça paginação. Para saldo, competência e borderôs, consulte o detalhe.', listFields, ['accountId', 'inicio', 'fim']),
  tool('finance_list_receivables', 'Lista títulos a receber para um período de até 366 dias. Faça paginação. Para saldo, competência e borderôs, consulte o detalhe.', listFields, ['accountId', 'inicio', 'fim']),
  tool('finance_get_payable', 'Obtém um título a pagar com saldo, categoria, competência e IDs dos borderôs, quando informados pelo Bling.', { accountId, id: entryId }, ['accountId', 'id']),
  tool('finance_get_receivable', 'Obtém um título a receber com saldo, categoria, competência e IDs dos borderôs, quando informados pelo Bling.', { accountId, id: entryId }, ['accountId', 'id']),
  tool('finance_list_categories', 'Lista categorias de receita/despesa do Bling para classificar lançamentos. Faça paginação.', { accountId, ...paging }, ['accountId']),
  tool('finance_list_cash_accounts', 'Lista contas financeiras e portadores do Bling. Este recurso não retorna saldo bancário ou extrato.', { accountId, ...paging }, ['accountId']),
  tool('finance_get_settlement', 'Consulta borderô por ID. Pode reunir vários pagamentos. Identifique a associação e evite somar o mesmo borderô duas vezes. Não equivale a extrato bancário.', { accountId, id: entryId }, ['accountId', 'id']),
];

function record(value: unknown): value is Fields {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${field} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function day(value: unknown, field: string): string {
  if (typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  throw new BadRequestException(`${field} deve ser uma data válida YYYY-MM-DD.`);
}

function relation(value: unknown) {
  return record(value) && typeof value.id === 'number' ? value.id : null;
}

function amount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function title(row: Fields) {
  return {
    id: row.id,
    situacao: row.situacao ?? null,
    vencimento: row.vencimento ?? null,
    valorOriginal: amount(row.valor),
    saldoEmAberto: amount(row.saldo),
    competencia: row.competencia ?? null,
    dataEmissao: row.dataEmissao ?? null,
    numeroDocumento: typeof row.numeroDocumento === 'string' ? row.numeroDocumento : null,
    categoriaId: relation(row.categoria),
    contaFinanceiraId: relation(row.portador) ?? relation(row.contaContabil),
    borderoIds: Array.isArray(row.borderos) ? row.borderos.filter(id => Number.isSafeInteger(id)) : null,
  };
}

@Injectable()
export class FinanceMcpService {
  constructor(private readonly accounts: AccountsService, private readonly bling: BlingService) {}

  async call(name: string, input: unknown, scope: { userId: string; accountIds: number[] }) {
    const definition = financeTools.find(candidate => candidate.name === name);
    if (!definition) throw new BadRequestException('Ferramenta financeira desconhecida.');
    if (!record(input) || Object.keys(input).some(key => !Object.hasOwn(definition.inputSchema.properties, key))) {
      throw new BadRequestException('Argumentos inválidos para a ferramenta.');
    }

    if (name === 'finance_list_accounts') {
      const owned = await this.accounts.list(scope.userId);
      return owned.filter(account => scope.accountIds.includes(account.id))
        .map(({ id, name: label, isActive }) => ({ id, nome: label, conectado: isActive }));
    }

    const id = integer(input.accountId, 'accountId');
    if (!scope.accountIds.includes(id)) throw new ForbiddenException('Conta Bling não autorizada.');

    switch (name) {
      case 'finance_list_payables': return this.listTitles(scope.userId, id, 'pagar', input);
      case 'finance_list_receivables': return this.listTitles(scope.userId, id, 'receber', input);
      case 'finance_get_payable':
      case 'finance_get_receivable': {
        const direction = name === 'finance_get_payable' ? 'pagar' : 'receber';
        const row = await this.getDetail(scope.userId, id, `contas/${direction}/${integer(input.id, 'id')}`);
        return { accountId: id, tipo: direction, titulo: title(row) };
      }
      case 'finance_list_categories':
        return this.page(scope.userId, id, 'categorias/receitas-despesas', input, new URLSearchParams(),
          row => ({ id: row.id, categoriaPaiId: row.idCategoriaPai ?? null, descricao: row.descricao, tipo: row.tipo }));
      case 'finance_list_cash_accounts':
        return this.page(scope.userId, id, 'contas-contabeis', input, new URLSearchParams(),
          row => ({ id: row.id, descricao: row.descricao, tipo: row.tipo }));
      case 'finance_get_settlement': {
        const row = await this.getDetail(scope.userId, id, `borderos/${integer(input.id, 'id')}`);
        return {
          accountId: id, id: row.id, data: row.data,
          contaFinanceiraId: relation(row.portador), categoriaId: relation(row.categoria),
          pagamentos: Array.isArray(row.pagamentos) ? row.pagamentos.filter(record).map(item => ({
            numeroDocumento: typeof item.numeroDocumento === 'string' ? item.numeroDocumento : null,
            valorPago: amount(item.valorPago), juros: amount(item.juros),
            desconto: amount(item.desconto), acrescimo: amount(item.acrescimo), tarifa: amount(item.tarifa),
          })) : null,
        };
      }
    }
  }

  private listTitles(userId: string, id: number, direction: Direction, input: Fields) {
    const inicio = day(input.inicio, 'inicio');
    const fim = day(input.fim, 'fim');
    const duration = Date.parse(fim) - Date.parse(inicio);
    if (duration < 0 || duration >= 366 * 86_400_000) throw new BadRequestException('Informe um período de até 366 dias.');
    const basis = input.base === undefined ? 'vencimento' : input.base;
    if (basis !== 'vencimento' && basis !== 'emissao' && basis !== 'liquidacao') {
      throw new BadRequestException('base deve ser vencimento, emissao ou liquidacao.');
    }
    const filter: Record<DateBasis, [string, string]> = {
      vencimento: ['V', 'Vencimento'],
      emissao: ['E', 'Emissao'],
      liquidacao: ['R', 'Pagamento'],
    };
    const [code, suffix] = filter[basis];
    const query = direction === 'pagar'
      ? new URLSearchParams({ [`data${suffix}Inicial`]: inicio, [`data${suffix}Final`]: fim })
      : new URLSearchParams({ tipoFiltroData: code, dataInicial: inicio, dataFinal: fim });
    if (input.situacao !== undefined) {
      query.set(direction === 'pagar' ? 'situacao' : 'situacoes[]', String(integer(input.situacao, 'situacao', 1, 5)));
    }
    return this.page(userId, id, `contas/${direction}`, input, query, title)
      .then(result => ({ ...result, tipo: direction, periodo: { inicio, fim, base: basis } }));
  }

  private async page<T>(userId: string, id: number, path: string, input: Fields, query: URLSearchParams, project: (row: Fields) => T) {
    const pagina = integer(input.pagina === undefined ? 1 : input.pagina, 'pagina');
    const limite = integer(input.limite === undefined ? 50 : input.limite, 'limite', 1, 100);
    query.set('pagina', String(pagina));
    query.set('limite', String(limite));
    const data = await this.fetch(userId, id, `${path}?${query}`);
    if (!Array.isArray(data) || !data.every(record)) throw new BadGatewayException('Formato inesperado da lista no Bling.');
    return {
      accountId: id, fonte: 'Bling API v3', pagina, limite,
      proximaPagina: data.length === limite ? pagina + 1 : null, itens: data.map(project),
    };
  }

  private async getDetail(userId: string, id: number, path: string) {
    const data = await this.fetch(userId, id, path);
    if (!record(data)) throw new BadGatewayException('Formato inesperado do detalhe no Bling.');
    return data;
  }

  private async fetch(userId: string, id: number, path: string): Promise<unknown> {
    const result: unknown = await this.accounts.run(userId, id, async () => {
      try {
        return await this.bling.makeAuthenticatedRequest(`/Api/v3/${path}`, {
          method: 'GET', signal: AbortSignal.timeout(15_000),
        }, false);
      } catch (error) {
        if (error instanceof BlingApiException) {
          if (error.upstreamStatus === 401 || error.upstreamStatus === 403) {
            throw new ForbiddenException('Verifique a autorização financeira da conta e os escopos do aplicativo Bling.');
          }
          if (error.upstreamStatus === 404) throw new NotFoundException('Registro não encontrado na conta Bling.');
          if (error.upstreamStatus === 429) throw new ServiceUnavailableException('Limite de consultas do Bling atingido. Tente mais tarde.');
          if (error.upstreamStatus === 400) throw new BadRequestException('O Bling recusou os filtros da consulta.');
        }
        throw new BadGatewayException('Consulta financeira indisponível no Bling.');
      }
    });
    if (!record(result) || !Object.hasOwn(result, 'data')) throw new BadGatewayException('Bling não retornou dados financeiros em formato reconhecido.');
    return result.data;
  }
}
