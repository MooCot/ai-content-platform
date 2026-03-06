import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    bufferLogs: true,
  });

  const config = app.get(ConfigService<AppConfig, true>);

  // ── Security middleware ──────────────────────────────────────────────────────
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: config.get('nodeEnv', { infer: true }) === 'development' ? '*' : [],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  // ── Global validation pipe ───────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Swagger docs ─────────────────────────────────────────────────────────────
  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Multi-Brand AI Content Platform')
      .setDescription(
        'Production-grade AI content generation with RAG, multi-LLM routing, and agent pipelines',
      )
      .setVersion('1.0')
      .addTag('brands', 'Brand management')
      .addTag('rag', 'Document ingestion and semantic search')
      .addTag('content', 'AI content generation jobs')
      .addTag('streaming', 'SSE real-time streaming')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log('Swagger UI available at /docs');
  }

  const port = config.get('port', { infer: true });
  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}/api/v1`);
}

void bootstrap();
