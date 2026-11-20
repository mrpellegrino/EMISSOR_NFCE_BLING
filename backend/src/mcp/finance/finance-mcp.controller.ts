import {
  Body, Controller, ForbiddenException, Get, Headers, HttpException,
  NotFoundException, Post, Res, UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import type { Response } from 'express';
import { FinanceMcpService, financeTools } from './finance-mcp.service';

const protocols = ['2025-11-25', '2025-06-18', '2025-03-26'];
const privateConfigPath = '/run/office-finance-mcp/config.json';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function settings(): Record<string, unknown> {
  const { OFFICE_FINANCE_MCP_KEY: key, OFFICE_FINANCE_MCP_USER_ID: userId,
    OFFICE_FINANCE_MCP_ACCOUNT_IDS: accountIds } = process.env;
  if (key || userId || accountIds) return { key, userId, accountIds };
  try {
    const file = lstatSync(privateConfigPath);
    if (!file.isFile() || (file.mode & 0o077) !== 0 || file.size > 4096) return {};
    const value: unknown = JSON.parse(readFileSync(privateConfigPath, 'utf8'));
    return object(value) ? value : {};
  } catch {
    return {};
  }
}

@Controller('mcp/finance')
export class FinanceMcpController {
  constructor(private readonly finance: FinanceMcpService) {}

  private authorize(authorization?: string, origin?: string) {
    const config = settings();
    const key = typeof config.key === 'string' ? config.key.trim() : '';
    const userId = typeof config.userId === 'string' ? config.userId.trim() : '';
    const configured = typeof config.accountIds === 'string'
      ? config.accountIds.split(',').map(value => value.trim()) : [];
    const accountIds = configured.map(Number);
    if (!key || key.length < 32 || !userId || !configured.length ||
      configured.some(value => !/^[1-9]\d*$/.test(value)) ||
      accountIds.some(value => !Number.isSafeInteger(value))) {
      throw new NotFoundException('MCP financeiro indisponível.');
    }
    if (origin !== undefined) throw new ForbiddenException('Acesso direto de navegador indisponível.');
    const provided = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!provided || !timingSafeEqual(digest(provided), digest(key))) throw new UnauthorizedException();
    return { userId, accountIds };
  }

  @Get()
  get(
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() response: Response,
  ) {
    this.authorize(authorization, origin);
    response.set('Allow', 'POST').status(405).end();
  }

  @Post()
  async post(
    @Body() request: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() response: Response,
  ) {
    const scope = this.authorize(authorization, origin);
    response.set('Cache-Control', 'no-store');
    if (!object(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) {
      response.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    if (request.id === undefined) {
      response.status(202).end();
      return;
    }

    const result = (data: unknown) => response.status(200).json({ jsonrpc: '2.0', id: request.id, result: data });
    const params = object(request.params) ? request.params : {};
    switch (request.method) {
      case 'initialize': {
        const version = params.protocolVersion;
        result({
          protocolVersion: typeof version === 'string' && protocols.includes(version) ? version : protocols[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'vila-pet-office-finance', version: '1.0.0' },
        });
        return;
      }
      case 'ping':
        result({});
        return;
      case 'tools/list':
        result({ tools: financeTools });
        return;
      case 'tools/call': {
        try {
          const name = typeof params.name === 'string' ? params.name : '';
          const data = await this.finance.call(name, params.arguments === undefined ? {} : params.arguments, scope);
          result({ content: [{ type: 'text', text: JSON.stringify(data) }] });
        } catch (error) {
          const message = error instanceof HttpException ? error.message : 'Consulta financeira indisponível.';
          result({ isError: true, content: [{ type: 'text', text: message }] });
        }
        return;
      }
      default:
        response.status(200).json({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    }
  }
}
