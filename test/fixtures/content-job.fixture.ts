import { ContentJobEntity } from '../../src/content/entities/content-job.entity';
import { ContentType, JobStatus } from '../../src/common/types/domain.types';

export function createContentJobFixture(
  overrides: Partial<ContentJobEntity> = {},
): ContentJobEntity {
  return {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    brandId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    topic: 'Introduction to Vector Databases',
    contentType: ContentType.BLOG,
    status: JobStatus.QUEUED,
    agentTrace: [],
    result: null,
    errorMessage: null,
    queueJobId: null,
    attempts: 0,
    correlationId: 'corr-test-uuid',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as ContentJobEntity;
}
