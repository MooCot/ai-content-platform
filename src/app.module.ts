import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configuration, AppConfig } from './common/config/configuration';
import { BrandsModule } from './brands/brands.module';
import { RAGModule } from './rag/rag.module';
import { ContentModule } from './content/content.module';
import { AgentsModule } from './agents/agents.module';
import { LLMModule } from './llm/llm.module';
import { ToolsModule } from './tools/tools.module';
import { StreamingModule } from './streaming/streaming.module';
import { HealthController } from './common/health/health.controller';

// Entities
import { BrandEntity } from './brands/entities/brand.entity';
import { DocumentEntity } from './rag/entities/document.entity';
import { ContentJobEntity } from './content/entities/content-job.entity';

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
        entities: [BrandEntity, DocumentEntity, ContentJobEntity],
        synchronize: config.get('nodeEnv', { infer: true }) !== 'production',
        logging: config.get('nodeEnv', { infer: true }) === 'development',
        ssl: config.get('nodeEnv', { infer: true }) === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),

    // ── Feature modules (dependency order) ───────────────────────────────────
    LLMModule,
    ToolsModule,
    BrandsModule,
    RAGModule,
    StreamingModule,
    AgentsModule,
    ContentModule,
  ],
})
export class AppModule {}
