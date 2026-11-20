import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticateWithEnvCredentialsUseCase } from '../usecases/authenticate-with-env-credentials.usecase';

export interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authUseCase: AuthenticateWithEnvCredentialsUseCase,
  ) {
    const secret = configService.get<string>('JWT_SECRET') || 'default-secret';
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    return this.authUseCase.validateJwtPayload(payload);
  }
}
