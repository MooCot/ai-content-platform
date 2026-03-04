import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RAGService } from './services/rag.service';
import { TextSplitterService } from './services/text-splitter.service';
import { DocumentParserService } from './services/document-parser.service';
import { QdrantVectorStore } from './infrastructure/qdrant-vector-store';
import { RAGController } from './rag.controller';
import { DocumentEntity } from './entities/document.entity';
import { VECTOR_STORE_TOKEN } from '../common/interfaces/vector-store.interface';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([DocumentEntity]),
    MulterModule.register({ storage: memoryStorage() }),
    LLMModule,
  ],
  controllers: [RAGController],
  providers: [
    TextSplitterService,
    DocumentParserService,
    QdrantVectorStore,
    {
      provide: VECTOR_STORE_TOKEN,
      useExisting: QdrantVectorStore,
    },
    RAGService,
  ],
  exports: [RAGService],
})
export class RAGModule {}
