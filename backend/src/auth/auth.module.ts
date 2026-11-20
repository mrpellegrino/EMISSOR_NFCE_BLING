import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { AuthenticateWithEnvCredentialsUseCase } from './usecases/authenticate-with-env-credentials.usecase';
import { LoginBruteForceGuardUseCase } from './usecases/login-brute-force-guard.usecase';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
        } as any,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginBruteForceGuardUseCase,
    AuthenticateWithEnvCredentialsUseCase,
    JwtStrategy,
  ],
  exports: [
    AuthService,
    LoginBruteForceGuardUseCase,
    AuthenticateWithEnvCredentialsUseCase,
  ],
})
export class AuthModule {}
