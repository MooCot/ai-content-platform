import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { configuration, AppConfig } from './common/config/configuration';
import { BrandsModule } from './brands/brands.module';
import { RAGModule } from './rag/rag.module';
import { ContentModule } from './content/content.module';
import { AgentsModule } from './agents/agents.module';
import { LLMModule } from './llm/llm.module';
import { ToolsModule } from './tools/tools.module';
import { StreamingModule } from './streaming/streaming.module';
import { MemoryModule } from './memory/memory.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueueModule } from './queue/queue.module';
import { ContractsModule } from './contracts';
import { HealthController } from './common/health/health.controller';
import { CorrelationIdMiddleware } from './observability/middleware/correlation-id.middleware';

// Entities
import { BrandEntity } from './brands/entities/brand.entity';
import { DocumentEntity } from './rag/entities/document.entity';
import { ContentJobEntity } from './content/entities/content-job.entity';
import { MemoryEventEntity } from './memory/entities/memory-event.entity';
import { EvaluationRecordEntity } from './evaluation/entities/evaluation-record.entity';

@Module({
  controllers: [HealthController],
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        type: 'postgres',
        host: config.get('database.host', { infer: true }),
        port: config.get('database.port', { infer: true }),
        username: config.get('database.username', { infer: true }),
        password: config.get('database.password', { infer: true }),
        database: config.get('database.database', { infer: true }),
        entities: [
          BrandEntity,
          DocumentEntity,
          ContentJobEntity,
          MemoryEventEntity,
          EvaluationRecordEntity,
        ],
        synchronize: config.get('nodeEnv', { infer: true }) !== 'production',
        logging: config.get('nodeEnv', { infer: true }) === 'development',
        ssl:
          config.get('nodeEnv', { infer: true }) === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),

    // ── Redis / BullMQ (root connection, shared by all queues) ───────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          host: config.get('redis.host', { infer: true }),
          port: config.get('redis.port', { infer: true }),
          password: config.get('redis.password', { infer: true }),
        },
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      }),
    }),

    // ── Infrastructure & cross-cutting ───────────────────────────────────────
    ContractsModule, // @Global — ContractRegistryService everywhere
    ObservabilityModule, // @Global — MetricsService + TracingService everywhere
    LLMModule,
    ToolsModule,
    MemoryModule,

    // ── Domain modules ───────────────────────────────────────────────────────
    BrandsModule,
    RAGModule,
    StreamingModule,
    AgentsModule,
    EvaluationModule,
    QueueModule,
    ContentModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
