import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BlingService } from './bling.service';
import { AccountsService } from './accounts.service';

// OAuth returns without a JWT; the one-use, expiring state identifies the account.
@Controller('bling')
export class BlingCallbackController {
  constructor(private readonly bling: BlingService, private readonly accounts: AccountsService) {}
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
      if (typeof code !== 'string' || !code) throw new BadRequestException('Código de autorização não recebido.');
      const account = await this.bling.findOAuthAccount(state);
      await this.accounts.run(account.userId, account.id, () => this.bling.exchangeCodeForTokens(code, state));
      return res.redirect(frontend + '/settings?bling=success&account=' + account.id);
    } catch {
      return res.redirect(frontend + '/settings?bling=error');
    }
  }
}
