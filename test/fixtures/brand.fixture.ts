import { BrandEntity } from '../../src/brands/entities/brand.entity';
import { LLMProvider, Tone } from '../../src/common/types/domain.types';

export function createBrandFixture(overrides: Partial<BrandEntity> = {}): BrandEntity {
  return {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    slug: 'test-brand',
    name: 'Test Brand',
    config: {
      defaultTone: Tone.TECHNICAL,
      allowedModels: ['claude-sonnet-4-6', 'gpt-4o'],
      preferredProvider: LLMProvider.CLAUDE,
      ragEnabled: true,
      systemPrompt: 'You are a technical writer.',
      maxContentLength: 2000,
    },
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as BrandEntity;
}
