import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { LoginDto } from '../dto/login.dto';
import { UsersService } from '../../users/users.service';
import { LoginBruteForceGuardUseCase } from './login-brute-force-guard.usecase';

export interface EnvAuthUser {
  id: string;
  name: string;
  email: string;
}

const DEFAULT_OWNER_ID = '55b54334-fa70-480f-9af8-f26792a0e786';

@Injectable()
export class AuthenticateWithEnvCredentialsUseCase {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly bruteForceGuardUseCase: LoginBruteForceGuardUseCase,
  ) {}

  getConfiguredAdmin(): EnvAuthUser & { password: string } {
    const email = (
      this.configService.get<string>('AUTH_USER') ||
      this.configService.get<string>('ADMIN_EMAIL') ||
      'admin@vilapet.com.br'
    ).trim();

    const password =
      this.configService.get<string>('AUTH_PASSWORD') ||
      this.configService.get<string>('ADMIN_PASSWORD') ||
      'VilaPet#Office!2026';

    const id = (
      this.configService.get<string>('AUTH_USER_ID') || DEFAULT_OWNER_ID
    ).trim();

    const name = (
      this.configService.get<string>('AUTH_USER_NAME') || 'Vila Pet Office'
    ).trim();

    return { id, name, email, password };
  }

  private async resolveOwnerId(configuredId: string): Promise<string> {
    try {
      const existing = await this.usersService.findById(configuredId);
      if (existing) {
        return existing.id;
      }
    } catch {
      // fallback to default owner id
    }
    return configuredId;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  async login(loginDto: LoginDto, clientIp = 'unknown') {
    const admin = this.getConfiguredAdmin();
    const inputUser = (loginDto.email || '').trim().toLowerCase();
    this.bruteForceGuardUseCase.assertNotLocked(clientIp, inputUser);

    const expectedUser = admin.email.toLowerCase();
    const inputPass = loginDto.password || '';

    const userMatches = this.safeEqual(inputUser, expectedUser);
    const passMatches = this.safeEqual(inputPass, admin.password);

    if (!userMatches || !passMatches) {
      const failure = this.bruteForceGuardUseCase.recordFailure(
        clientIp,
        inputUser,
      );
      if (failure.locked && failure.retryAfterSeconds && failure.lockedUntil) {
        throw this.bruteForceGuardUseCase.createLockoutException(
          failure.retryAfterSeconds,
          failure.lockedUntil,
        );
      }
      throw new UnauthorizedException(
        `Usuário ou senha inválidos. Restam ${failure.remainingAttempts} tentativa(s) antes do bloqueio temporário.`,
      );
    }

    this.bruteForceGuardUseCase.recordSuccess(clientIp, inputUser);

    const ownerId = await this.resolveOwnerId(admin.id);
    const payload = { sub: ownerId, email: admin.email, name: admin.name };

    return {
      user: {
        id: ownerId,
        name: admin.name,
        email: admin.email,
      },
      access_token: this.jwtService.sign(payload),
    };
  }

  async registerDisabled(): Promise<never> {
    throw new ForbiddenException(
      'O cadastro público está desabilitado. As credenciais de acesso são definidas nas variáveis de ambiente do servidor.',
    );
  }

  validateJwtPayload(payload: { sub: string; email?: string }): EnvAuthUser {
    const admin = this.getConfiguredAdmin();
    if (!payload?.sub) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
    return {
      id: payload.sub,
      name: admin.name,
      email: admin.email,
    };
  }

  getProfile() {
    const admin = this.getConfiguredAdmin();
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
    };
  }
}
