import { Injectable } from '@nestjs/common';
import { ListMcpToolsUseCase } from './list-mcp-tools.usecase';
import { ExecuteMcpToolUseCase } from './execute-mcp-tool.usecase';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

@Injectable()
export class HandleMcpJsonRpcUseCase {
  constructor(
    private readonly listToolsUseCase: ListMcpToolsUseCase,
    private readonly executeToolUseCase: ExecuteMcpToolUseCase,
  ) {}

  async execute(payload: JsonRpcRequest) {
    const id = payload.id ?? null;
    const method = payload.method;

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'vila-pet-office-mcp',
              version: '1.0.0',
            },
          },
        };
      }

      if (method === 'notifications/initialized') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.listToolsUseCase.execute(),
          },
        };
      }

      if (method === 'tools/call') {
        const toolName = String(payload.params?.name ?? '');
        const toolArgs =
          (payload.params?.arguments as Record<string, unknown>) ?? {};
        const output = await this.executeToolUseCase.execute(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2),
              },
            ],
            isError: false,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao executar método MCP';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true,
        },
      };
    }
  }
}
