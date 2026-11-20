import { Body, Controller, Get, Post, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountsService } from './accounts.service';

@Controller('bling/accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}
  @Get()
  list(@Request() req: any) { return this.accounts.list(req.user.id); }
  @Post()
  create(@Request() req: any, @Body() body: { name: string }) {
    return this.accounts.create(req.user.id, body.name);
  }

  @Post(':id/automacao')
  setAutomation(@Request() req: any, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.accounts.setAutomation(req.user.id, Number(id), body.enabled);
  }
}
