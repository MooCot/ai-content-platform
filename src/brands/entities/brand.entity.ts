import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tone, LLMProvider } from '../../common/types/domain.types';

export interface BrandConfig {
  defaultTone: Tone;
  allowedModels: string[];
  preferredProvider: LLMProvider;
  ragEnabled: boolean;
  systemPrompt: string;
  maxContentLength: number;
}

@Entity('brands')
export class BrandEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  slug!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb' })
  config!: BrandConfig;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
