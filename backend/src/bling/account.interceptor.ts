import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import { AccountsService } from './accounts.service';
import { Reflector } from '@nestjs/core';
import { LOCAL_ACCOUNT_READ } from './local-account-read.decorator';

@Injectable()
export class AccountInterceptor implements NestInterceptor {
  constructor(private readonly accounts: AccountsService, private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const id = Number(request.headers['x-account-id']);
    if (this.reflector.get<boolean>(LOCAL_ACCOUNT_READ, context.getHandler())) {
      return from(this.accounts.runLocalRead(request.user.id, id, () => lastValueFrom(next.handle())));
    }
    return from(this.accounts.run(request.user.id, id, () => lastValueFrom(next.handle())));
  }
}
