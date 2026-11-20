import { Module } from '@nestjs/common';
import { BlingModule } from '../bling/bling.module';
import { CrmModule } from '../crm/crm.module';
import { AdsModule } from '../ads/ads.module';
import { McpController } from './mcp.controller';
import { ListMcpToolsUseCase } from './usecases/list-mcp-tools.usecase';
import { ExecuteMcpToolUseCase } from './usecases/execute-mcp-tool.usecase';
import { HandleMcpJsonRpcUseCase } from './usecases/handle-mcp-jsonrpc.usecase';
import { FinanceMcpController } from './finance/finance-mcp.controller';
import { FinanceMcpService } from './finance/finance-mcp.service';

@Module({
  imports: [BlingModule, CrmModule, AdsModule],
  controllers: [McpController, FinanceMcpController],
  providers: [
    ListMcpToolsUseCase,
    ExecuteMcpToolUseCase,
    HandleMcpJsonRpcUseCase,
    FinanceMcpService,
  ],
  exports: [ListMcpToolsUseCase, ExecuteMcpToolUseCase],
})
export class McpModule {}
