import { Injectable, BadRequestException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { BlingIntegration } from './entities/bling-integration.entity';

@Injectable()
export class AccountContext {
  private readonly storage = new AsyncLocalStorage<BlingIntegration>();
  run<T>(account: BlingIntegration, action: () => T): T {
    return this.storage.run(account, action);
  }
  get account(): BlingIntegration {
    const account = this.storage.getStore();
    if (!account) throw new BadRequestException('Selecione uma conta Bling.');
    return account;
  }
}
