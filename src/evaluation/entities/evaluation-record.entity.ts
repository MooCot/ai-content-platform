import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';
import { EvaluationDimensions } from '../../common/types/domain.types';

@Entity('evaluation_records')
@Index(['brandId', 'modelId', 'evaluatedAt'])
export class EvaluationRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'job_id' })
  @Index()
  jobId!: string;

  @Column({ name: 'brand_id' })
  @Index()
  brandId!: string;

  @Column({ name: 'content_type' })
  contentType!: string;

  /** LLM model that produced the final content (from last agent step). */
  @Column({ name: 'model_id' })
  modelId!: string;

  /** Semver hash of the prompt template used — enables A/B regression tracking. */
  @Column({ name: 'prompt_version' })
  promptVersion!: string;

  @Column({ name: 'relevance_score', type: 'float' })
  relevanceScore!: number;

  @Column({ name: 'tone_score', type: 'float' })
  toneScore!: number;

  @Column({ name: 'factuality_score', type: 'float' })
  factualityScore!: number;

  @Column({ name: 'readability_score', type: 'float' })
  readabilityScore!: number;

  @Column({ name: 'composite_score', type: 'float' })
  compositeScore!: number;

  /** Full per-dimension breakdown including qualitative details. */
  @Column({ type: 'jsonb' })
  dimensions!: EvaluationDimensions;

  @CreateDateColumn({ name: 'evaluated_at' })
  evaluatedAt!: Date;
}
