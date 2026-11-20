import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlingIntegration } from './entities/bling-integration.entity';
import { AccountContext } from './account-context';

@Injectable()
export class AccountsService {
  private readonly pending = new Map<number, Promise<unknown>>();
  constructor(
    @InjectRepository(BlingIntegration) private readonly repository: Repository<BlingIntegration>,
    private readonly context: AccountContext,
  ) {}
  async list(userId: string) {
    const accounts = await this.repository.find({ where: { userId }, order: { id: 'ASC' } });
    return accounts.map(({ id, name, clientId, accessToken, refreshToken, initialOrderNumber }) => ({
      id, name, configured: !!clientId, isActive: !!(accessToken && refreshToken), initialOrderNumber,
    }));
  }
  async create(userId: string, name: unknown) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      throw new BadRequestException('Informe um nome de conta com até 100 caracteres.');
    }
    const account = await this.repository.save(this.repository.create({ userId, name: name.trim(), isActive: false }));
    return { id: account.id, name: account.name, configured: false, isActive: false };
  }
  async findOwned(userId: string, id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('Selecione uma conta válida.');
    const account = await this.repository.findOne({ where: { id, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    return account;
  }

  async setAutomation(userId: string, id: number, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('Informe se a fila deve estar ligada ou pausada.');
    await this.findOwned(userId, id);
    // Do not wait for the emission lock: a pause must reach an active batch.
    await this.repository.update({ id, userId }, { autoRpsEnabled: enabled });
    return { accountEnabled: enabled };
  }
  async runLocalRead<T>(userId: string, id: number, action: () => Promise<T>): Promise<T> {
    const account = await this.findOwned(userId, id);
    return this.context.run(account, action);
  }

  // Serialize operations for one account, including token renewal. Other accounts run independently.
  async run<T>(userId: string, id: number, action: () => Promise<T>): Promise<T> {
    await this.findOwned(userId, id);
    const previous = this.pending.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const account = await this.findOwned(userId, id);
      return this.context.run(account, action);
    });
    this.pending.set(id, operation);
    try { return await operation; }
    finally { if (this.pending.get(id) === operation) this.pending.delete(id); }
  }
}
