import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AgentStep, ContentResult, ContentType, JobStatus } from '../../common/types/domain.types';
import { BrandEntity } from '../../brands/entities/brand.entity';

@Entity('content_jobs')
@Index(['brandId', 'status'])
export class ContentJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'brand_id' })
  @Index()
  brandId!: string;

  @ManyToOne(() => BrandEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand!: BrandEntity;

  @Column()
  topic!: string;

  @Column({
    name: 'content_type',
    type: 'enum',
    enum: ContentType,
  })
  contentType!: ContentType;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.QUEUED,
  })
  status!: JobStatus;

  @Column({ name: 'agent_trace', type: 'jsonb', default: [] })
  agentTrace!: AgentStep[];

  @Column({ type: 'jsonb', nullable: true })
  result!: ContentResult | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  /** BullMQ job ID — same as `id` (used as idempotency key). Kept for debuggability. */
  @Column({ name: 'queue_job_id', nullable: true })
  queueJobId!: string | null;

  /** How many times this job has been attempted (incremented by the processor). */
  @Column({ default: 0 })
  attempts!: number;

  /** X-Correlation-ID from the originating HTTP request. */
  @Column({ name: 'correlation_id', nullable: true })
  correlationId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
