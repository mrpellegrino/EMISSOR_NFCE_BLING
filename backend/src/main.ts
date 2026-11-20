import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 2);
  app.enableShutdownHooks();

  // Habilita validação global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // Habilita CORS para o frontend e para o formulário público do site Vila Pet
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://vilapetbrasil.com.br',
    'https://www.vilapetbrasil.com.br',
    'http://vilapetbrasil.com.br',
    'http://www.vilapetbrasil.com.br',
    ...(process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean)
      : []),
    ...(process.env.SITE_ORIGINS
      ? process.env.SITE_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : []),
  ];

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Account-Id', 'X-Webhook-Key'],
    exposedHeaders: ['Retry-After'],
    credentials: true,
  });

  // Prefixo global para API
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  
  console.log(`🚀 Backend rodando em: http://localhost:${port}/api`);
}
bootstrap();
