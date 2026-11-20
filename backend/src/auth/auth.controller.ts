import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AuthenticateWithEnvCredentialsUseCase } from './usecases/authenticate-with-env-credentials.usecase';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authUseCase: AuthenticateWithEnvCredentialsUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    try {
      return await this.authUseCase.login(loginDto, clientIp);
    } catch (err) {
      if (
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        const payload = err.getResponse();
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'retryAfterSeconds' in payload &&
          typeof payload.retryAfterSeconds === 'number'
        ) {
          res.setHeader('Retry-After', String(payload.retryAfterSeconds));
        }
      }
      throw err;
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.FORBIDDEN)
  async register() {
    return this.authUseCase.registerDisabled();
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile() {
    return this.authUseCase.getProfile();
  }

  @UseGuards(JwtAuthGuard)
  @Get('validate')
  @HttpCode(HttpStatus.OK)
  async validateToken(@Request() req: { user?: unknown }) {
    return {
      valid: true,
      user: req.user,
    };
  }
}
