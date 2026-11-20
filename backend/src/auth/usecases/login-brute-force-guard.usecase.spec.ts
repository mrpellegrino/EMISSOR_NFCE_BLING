import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginBruteForceGuardUseCase } from './login-brute-force-guard.usecase';
import { AuthenticateWithEnvCredentialsUseCase } from './authenticate-with-env-credentials.usecase';
import { UsersService } from '../../users/users.service';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  const defaults: Record<string, string> = {
    AUTH_USER: 'admin@vilapet.com.br',
    AUTH_PASSWORD: 'StrongPassword#2026',
    AUTH_USER_NAME: 'Vila Pet Office',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => defaults[key]),
  } as unknown as ConfigService;
}

describe('LoginBruteForceGuardUseCase', () => {
  it('allows failures below LOGIN_MAX_ATTEMPTS and decrements remaining attempts', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    for (let i = 1; i <= 4; i++) {
      guard.assertNotLocked('198.51.100.10', 'admin@vilapet.com.br', t0 + i * 1000);
      const res = guard.recordFailure('198.51.100.10', 'admin@vilapet.com.br', t0 + i * 1000);
      expect(res.locked).toBe(false);
      expect(res.remainingAttempts).toBe(5 - i);
    }
  });

  it('locks on the 5th failed attempt and rejects subsequent assertNotLocked calls with 429', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    for (let i = 1; i <= 4; i++) {
      guard.recordFailure('198.51.100.20', 'admin@vilapet.com.br', t0);
    }

    const fifth = guard.recordFailure('198.51.100.20', 'admin@vilapet.com.br', t0);
    expect(fifth.locked).toBe(true);
    expect(fifth.remainingAttempts).toBe(0);
    expect(fifth.retryAfterSeconds).toBe(900);
    expect(fifth.lockedUntil).toBe(new Date(t0 + 15 * 60 * 1000).toISOString());

    try {
      guard.assertNotLocked('198.51.100.20', 'admin@vilapet.com.br', t0 + 5000);
      fail('Expected HttpException 429');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = httpErr.getResponse() as Record<string, unknown>;
      expect(body.retryAfterSeconds).toBe(895);
    }
  });

  it('unlocks automatically once lockout expires and escalates duration on repeat offense', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    // First lockout: 15 minutes
    for (let i = 0; i < 5; i++) {
      guard.recordFailure('198.51.100.30', 'user@vilapet.com.br', t0);
    }

    const afterFirstLockout = t0 + 15 * 60 * 1000;
    expect(() =>
      guard.assertNotLocked('198.51.100.30', 'user@vilapet.com.br', afterFirstLockout),
    ).not.toThrow();

    // Second lockout: 30 minutes (exponential backoff)
    for (let i = 0; i < 4; i++) {
      const r = guard.recordFailure('198.51.100.30', 'user@vilapet.com.br', afterFirstLockout + i * 1000);
      expect(r.locked).toBe(false);
    }
    const secondLockout = guard.recordFailure(
      '198.51.100.30',
      'user@vilapet.com.br',
      afterFirstLockout + 4000,
    );
    expect(secondLockout.locked).toBe(true);
    expect(secondLockout.retryAfterSeconds).toBe(1800);

    // Third lockout after 30m: 60 minutes (capped at LOGIN_MAX_LOCKOUT_MINUTES)
    const afterSecondLockout = afterFirstLockout + 4000 + 30 * 60 * 1000;
    for (let i = 0; i < 4; i++) {
      guard.recordFailure('198.51.100.30', 'other@vilapet.com.br', afterSecondLockout + i * 1000);
    }
    const thirdLockout = guard.recordFailure(
      '198.51.100.30',
      'other@vilapet.com.br',
      afterSecondLockout + 4000,
    );
    expect(thirdLockout.locked).toBe(true);
    expect(thirdLockout.retryAfterSeconds).toBe(3600);
  });

  it('caps escalating lockout at LOGIN_MAX_LOCKOUT_MINUTES', () => {
    const guard = new LoginBruteForceGuardUseCase(
      createConfig({
        LOGIN_LOCKOUT_MINUTES: '20',
        LOGIN_MAX_LOCKOUT_MINUTES: '30',
      }),
    );
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < 5; i++) {
      guard.recordFailure('198.51.100.40', 'cap@vilapet.com.br', t0);
    }
    const t1 = t0 + 20 * 60 * 1000;
    let second!: ReturnType<LoginBruteForceGuardUseCase['recordFailure']>;
    for (let i = 0; i < 5; i++) {
      second = guard.recordFailure('198.51.100.40', 'cap@vilapet.com.br', t1 + i * 100);
    }
    expect(second.locked).toBe(true);
    expect(second.retryAfterSeconds).toBe(1800); // capped at 30 minutes instead of 40
  });

  it('resets failure count and lockout escalation on recordSuccess', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < 4; i++) {
      guard.recordFailure('198.51.100.50', 'admin@vilapet.com.br', t0);
    }
    guard.recordSuccess('198.51.100.50', 'admin@vilapet.com.br');

    const freshFailure = guard.recordFailure('198.51.100.50', 'admin@vilapet.com.br', t0 + 1000);
    expect(freshFailure.locked).toBe(false);
    expect(freshFailure.remainingAttempts).toBe(4);
  });

  it('blocks distributed password spraying targeting the same account across IPs after 10 attempts', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    for (let i = 1; i <= 9; i++) {
      const res = guard.recordFailure(`203.0.113.${i}`, 'admin@vilapet.com.br', t0 + i * 100);
      expect(res.locked).toBe(false);
    }

    const tenth = guard.recordFailure('203.0.113.10', 'admin@vilapet.com.br', t0 + 1000);
    expect(tenth.locked).toBe(true);
    expect(tenth.retryAfterSeconds).toBe(900);

    // Even a brand new IP trying the same account must be blocked
    expect(() =>
      guard.assertNotLocked('203.0.113.99', 'ADMIN@vilapet.com.br', t0 + 2000),
    ).toThrow(HttpException);
  });

  it('normalizes IPv6-mapped IPv4 addresses identically to IPv4', () => {
    const guard = new LoginBruteForceGuardUseCase(createConfig());
    const t0 = 1_700_000_000_000;

    guard.recordFailure('::ffff:192.0.2.1', 'u1@vilapet.com.br', t0);
    guard.recordFailure('192.0.2.1', 'u2@vilapet.com.br', t0);
    guard.recordFailure('::ffff:192.0.2.1', 'u3@vilapet.com.br', t0);
    guard.recordFailure('192.0.2.1', 'u4@vilapet.com.br', t0);
    const fifth = guard.recordFailure('::ffff:192.0.2.1', 'u5@vilapet.com.br', t0);

    expect(fifth.locked).toBe(true);
    expect(() =>
      guard.assertNotLocked('192.0.2.1', 'u6@vilapet.com.br', t0 + 1000),
    ).toThrow(HttpException);
  });
});

describe('AuthenticateWithEnvCredentialsUseCase brute-force integration', () => {
  function createAuthUseCase() {
    const config = createConfig();
    const guard = new LoginBruteForceGuardUseCase(config);
    const jwtService = {
      sign: jest.fn(() => 'signed-jwt-token'),
    } as unknown as JwtService;
    const usersService = {
      findById: jest.fn(async (id: string) => ({ id })),
    } as unknown as UsersService;

    return new AuthenticateWithEnvCredentialsUseCase(
      config,
      jwtService,
      usersService,
      guard,
    );
  }

  it('rejects 4 wrong attempts with remaining counts, locks on 5th with 429, and blocks even valid password while locked', async () => {
    const authUseCase = createAuthUseCase();
    const ip = '198.51.100.77';

    for (let remaining = 4; remaining >= 1; remaining--) {
      await expect(
        authUseCase.login(
          { email: 'admin@vilapet.com.br', password: 'wrong' },
          ip,
        ),
      ).rejects.toThrow(
        new UnauthorizedException(
          `Usuário ou senha inválidos. Restam ${remaining} tentativa(s) antes do bloqueio temporário.`,
        ),
      );
    }

    // 5th failure triggers 429
    try {
      await authUseCase.login(
        { email: 'admin@vilapet.com.br', password: 'wrong' },
        ip,
      );
      fail('Expected 429 on 5th failure');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    // Even valid credentials must be blocked while locked
    try {
      await authUseCase.login(
        { email: 'admin@vilapet.com.br', password: 'StrongPassword#2026' },
        ip,
      );
      fail('Expected 429 even with valid password while locked');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('succeeds on valid credentials before lockout and resets failure counter', async () => {
    const authUseCase = createAuthUseCase();
    const ip = '198.51.100.88';

    for (let i = 0; i < 4; i++) {
      await expect(
        authUseCase.login(
          { email: 'admin@vilapet.com.br', password: 'wrong' },
          ip,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const res = await authUseCase.login(
      { email: 'admin@vilapet.com.br', password: 'StrongPassword#2026' },
      ip,
    );
    expect(res.access_token).toBe('signed-jwt-token');

    // Counter should be reset, so another wrong attempt starts at 4 remaining again
    await expect(
      authUseCase.login(
        { email: 'admin@vilapet.com.br', password: 'wrong' },
        ip,
      ),
    ).rejects.toThrow(
      'Usuário ou senha inválidos. Restam 4 tentativa(s) antes do bloqueio temporário.',
    );
  });
});
