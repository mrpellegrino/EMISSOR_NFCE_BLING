import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AttemptRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number | null;
  lockoutCount: number;
  lastAttemptAt: number;
}

export interface BruteForceFailureResult {
  locked: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
  lockedUntil?: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_ACCOUNT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_LOCKOUT_MINUTES = 15;
const DEFAULT_MAX_LOCKOUT_MINUTES = 1440;
const PRUNE_THRESHOLD = 10000;

@Injectable()
export class LoginBruteForceGuardUseCase {
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(private readonly configService: ConfigService) {}

  private parsePositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getPolicy() {
    const maxAttempts = this.parsePositiveInt(
      'LOGIN_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
    );
    const accountMaxAttempts = this.parsePositiveInt(
      'LOGIN_ACCOUNT_MAX_ATTEMPTS',
      DEFAULT_ACCOUNT_MAX_ATTEMPTS,
    );
    const windowMs =
      this.parsePositiveInt('LOGIN_WINDOW_MINUTES', DEFAULT_WINDOW_MINUTES) *
      60 *
      1000;
    const baseLockoutMs =
      this.parsePositiveInt('LOGIN_LOCKOUT_MINUTES', DEFAULT_LOCKOUT_MINUTES) *
      60 *
      1000;
    const maxLockoutMs = Math.max(
      baseLockoutMs,
      this.parsePositiveInt(
        'LOGIN_MAX_LOCKOUT_MINUTES',
        DEFAULT_MAX_LOCKOUT_MINUTES,
      ) *
        60 *
        1000,
    );

    return {
      maxAttempts,
      accountMaxAttempts,
      windowMs,
      baseLockoutMs,
      maxLockoutMs,
    };
  }

  private normalizeIp(rawIp?: string): string {
    const cleaned = (rawIp || '').trim();
    if (!cleaned) {
      return 'unknown';
    }
    return cleaned.startsWith('::ffff:') ? cleaned.slice(7) : cleaned;
  }

  private buildKeys(clientIp: string, identifier: string): {
    ipKey: string;
    userKey: string | null;
  } {
    const normalizedUser = (identifier || '').trim().toLowerCase();
    return {
      ipKey: `ip:${this.normalizeIp(clientIp)}`,
      userKey: normalizedUser ? `user:${normalizedUser}` : null,
    };
  }

  private formatRemainingTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} segundo(s)`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) {
      return `${mins} minuto(s)`;
    }
    return `${mins}m ${secs}s`;
  }

  private pruneExpired(now: number, windowMs: number, maxLockoutMs: number): void {
    if (this.attempts.size <= PRUNE_THRESHOLD) {
      return;
    }
    const maxRetentionMs = Math.max(windowMs, maxLockoutMs * 2);
    for (const [key, rec] of this.attempts.entries()) {
      const lockExpired = !rec.lockedUntil || rec.lockedUntil <= now;
      if (lockExpired && now - rec.lastAttemptAt > maxRetentionMs) {
        this.attempts.delete(key);
      }
    }
  }

  private incrementBucket(
    key: string,
    threshold: number,
    now: number,
    windowMs: number,
    baseLockoutMs: number,
    maxLockoutMs: number,
  ): AttemptRecord {
    const existing = this.attempts.get(key);
    if (existing && existing.lockedUntil !== null && existing.lockedUntil > now) {
      existing.lastAttemptAt = now;
      return existing;
    }

    let record: AttemptRecord;
    if (!existing) {
      record = {
        failures: 0,
        firstFailureAt: now,
        lockedUntil: null,
        lockoutCount: 0,
        lastAttemptAt: now,
      };
    } else if (existing.lockedUntil !== null && existing.lockedUntil <= now) {
      record = {
        failures: 0,
        firstFailureAt: now,
        lockedUntil: null,
        lockoutCount:
          now - existing.lastAttemptAt > maxLockoutMs * 2
            ? 0
            : existing.lockoutCount,
        lastAttemptAt: now,
      };
    } else if (now - existing.firstFailureAt > windowMs) {
      record = {
        failures: 0,
        firstFailureAt: now,
        lockedUntil: null,
        lockoutCount: 0,
        lastAttemptAt: now,
      };
    } else {
      record = existing;
    }

    record.failures += 1;
    record.lastAttemptAt = now;

    if (record.failures >= threshold) {
      record.lockoutCount += 1;
      const lockDurationMs = Math.min(
        baseLockoutMs * Math.pow(2, record.lockoutCount - 1),
        maxLockoutMs,
      );
      record.lockedUntil = now + lockDurationMs;
      record.failures = 0;
    }

    this.attempts.set(key, record);
    return record;
  }

  createLockoutException(
    retryAfterSeconds: number,
    lockedUntil: string,
  ): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: `Muitas tentativas de login incorretas. Login bloqueado temporariamente. Tente novamente em ${this.formatRemainingTime(retryAfterSeconds)}.`,
        retryAfterSeconds,
        lockedUntil,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  assertNotLocked(clientIp: string, identifier: string, now = Date.now()): void {
    const { ipKey, userKey } = this.buildKeys(clientIp, identifier);
    const keys = userKey ? [ipKey, userKey] : [ipKey];

    let maxLockedUntil = 0;
    for (const key of keys) {
      const rec = this.attempts.get(key);
      if (rec?.lockedUntil && rec.lockedUntil > now && rec.lockedUntil > maxLockedUntil) {
        maxLockedUntil = rec.lockedUntil;
      }
    }

    if (maxLockedUntil > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((maxLockedUntil - now) / 1000),
      );
      throw this.createLockoutException(
        retryAfterSeconds,
        new Date(maxLockedUntil).toISOString(),
      );
    }
  }

  recordFailure(
    clientIp: string,
    identifier: string,
    now = Date.now(),
  ): BruteForceFailureResult {
    const {
      maxAttempts,
      accountMaxAttempts,
      windowMs,
      baseLockoutMs,
      maxLockoutMs,
    } = this.getPolicy();

    this.pruneExpired(now, windowMs, maxLockoutMs);

    const { ipKey, userKey } = this.buildKeys(clientIp, identifier);
    const ipRecord = this.incrementBucket(
      ipKey,
      maxAttempts,
      now,
      windowMs,
      baseLockoutMs,
      maxLockoutMs,
    );

    const userRecord = userKey
      ? this.incrementBucket(
          userKey,
          accountMaxAttempts,
          now,
          windowMs,
          baseLockoutMs,
          maxLockoutMs,
        )
      : null;

    let maxLockedUntil = 0;
    if (ipRecord.lockedUntil && ipRecord.lockedUntil > now) {
      maxLockedUntil = Math.max(maxLockedUntil, ipRecord.lockedUntil);
    }
    if (userRecord?.lockedUntil && userRecord.lockedUntil > now) {
      maxLockedUntil = Math.max(maxLockedUntil, userRecord.lockedUntil);
    }

    if (maxLockedUntil > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((maxLockedUntil - now) / 1000),
      );
      return {
        locked: true,
        remainingAttempts: 0,
        retryAfterSeconds,
        lockedUntil: new Date(maxLockedUntil).toISOString(),
      };
    }

    return {
      locked: false,
      remainingAttempts: Math.max(0, maxAttempts - ipRecord.failures),
    };
  }

  recordSuccess(clientIp: string, identifier: string): void {
    const { ipKey, userKey } = this.buildKeys(clientIp, identifier);
    this.attempts.delete(ipKey);
    if (userKey) {
      this.attempts.delete(userKey);
    }
  }
}
