import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListMcpToolsUseCase } from './usecases/list-mcp-tools.usecase';
import { ExecuteMcpToolUseCase } from './usecases/execute-mcp-tool.usecase';
import { HandleMcpJsonRpcUseCase } from './usecases/handle-mcp-jsonrpc.usecase';
import type { JsonRpcRequest } from './usecases/handle-mcp-jsonrpc.usecase';

@Controller('mcp')
export class McpController {
  constructor(
    private readonly listToolsUseCase: ListMcpToolsUseCase,
    private readonly executeToolUseCase: ExecuteMcpToolUseCase,
    private readonly handleJsonRpcUseCase: HandleMcpJsonRpcUseCase,
  ) {}

  private getExpectedApiKey(): string {
    return process.env.MCP_API_KEY || 'vilapet-hermes-mcp-key';
  }

  private assertMcpKey(
    headerKey?: string,
    authHeader?: string,
    queryKey?: string,
  ) {
    const expected = this.getExpectedApiKey();
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
    const provided = headerKey || queryKey || bearer;
    if (provided !== expected) {
      throw new UnauthorizedException('MCP API Key inválida ou ausente');
    }
  }

  // Streamable HTTP JSON-RPC 2.0 endpoint for Hermes Agent
  @Post()
  async handleJsonRpc(
    @Body() body: JsonRpcRequest,
    @Headers('x-mcp-api-key') headerKey?: string,
    @Headers('authorization') authHeader?: string,
    @Query('apiKey') queryKey?: string,
  ) {
    this.assertMcpKey(headerKey, authHeader, queryKey);
    return this.handleJsonRpcUseCase.execute(body);
  }

  // Information & config endpoint for the Vila Pet Office UI
  @UseGuards(JwtAuthGuard)
  @Get('info')
  async getMcpInfo() {
    const overview = await this.executeToolUseCase.execute(
      'get_business_overview',
      {},
    );
    return {
      serverName: 'vila-pet-office-mcp',
      protocolVersion: '2024-11-05',
      internalDockerUrl: 'http://office-backend-sy1nl0:3000/api/mcp',
      publicPath: '/api/mcp',
      apiKey: this.getExpectedApiKey(),
      tools: this.listToolsUseCase.execute(),
      overview,
    };
  }

  // Interactive tool runner for testing Hermes tools from the Office UI
  @UseGuards(JwtAuthGuard)
  @Post('test-tool')
  async testTool(
    @Body() body: { name: string; arguments?: Record<string, unknown> },
  ) {
    return this.executeToolUseCase.execute(body.name, body.arguments ?? {});
  }
}
