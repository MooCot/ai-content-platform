import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationRecordEntity } from './entities/evaluation-record.entity';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { RelevanceEvaluator } from './evaluators/relevance.evaluator';
import { ToneEvaluator } from './evaluators/tone.evaluator';
import { FactualityEvaluator } from './evaluators/factuality.evaluator';
import { CompositeEvaluator } from './evaluators/composite.evaluator';
import { LLMModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EvaluationRecordEntity]),
    LLMModule, // for evaluators that call LLM
    MemoryModule, // for post-evaluation memory write
  ],
  controllers: [EvaluationController],
  providers: [
    EvaluationService,
    RelevanceEvaluator,
    ToneEvaluator,
    FactualityEvaluator,
    CompositeEvaluator,
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
