import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { AgentRole } from '../../common/types/domain.types';

/**
 * Append-only ledger of what each agent produced / observed.
 * High-quality events (score >= threshold) are also indexed in Qdrant
 * for semantic retrieval by future pipeline runs.
 */
@Entity('memory_events')
@Index(['brandId', 'createdAt'])
@Index(['brandId', 'eventType'])
export class MemoryEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'brand_id' })
  @Index()
  brandId!: string;

  /** The content-job that produced this event (nullable for brand-level events). */
  @Column({ name: 'job_id', nullable: true })
  jobId!: string | null;

  @Column({ type: 'enum', enum: AgentRole })
  agent!: AgentRole;

  /**
   * Semantic event type — drives query filtering.
   * Convention: 'generation_complete' | 'rag_context_used' | 'qa_revision'
   */
  @Column({ name: 'event_type' })
  eventType!: string;

  /** Human-readable summary of what was produced/observed. */
  @Column({ type: 'text' })
  content!: string;

  /**
   * Structured payload — topic, contentType, scores, etc.
   * Schema is open so agents can add dimension-specific metadata.
   */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /**
   * Set after embedAndIndex() succeeds.
   * Qdrant point ID = this entity's UUID for 1-to-1 mapping.
   */
  @Column({ name: 'qdrant_indexed', default: false })
  qdrantIndexed!: boolean;

  /** Semver hash of the prompt template that produced this event. */
  @Column({ name: 'prompt_version', default: '0.0.0' })
  promptVersion!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
