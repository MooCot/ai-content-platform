import { z } from 'zod';
import { ContractRegistryService } from './contract-registry.service';
import { ContractViolationException } from '../common/exceptions/domain.exceptions';

// ── Shared test schemas ────────────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.string().min(1),
  age: z.number().int().min(0),
});

// Schema with a transform so we can verify parsed output != raw input
const NormalisedSchema = z.object({
  name: z.string().transform((s) => s.trim().toLowerCase()),
});

// Nested schema to verify dotted-path issue formatting
const NestedSchema = z.object({
  user: z.object({
    email: z.string().email(),
  }),
});

type User = z.infer<typeof UserSchema>;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ContractRegistryService', () => {
  let service: ContractRegistryService;

  beforeEach(() => {
    // No dependencies — instantiate directly
    service = new ContractRegistryService();
  });

  // ── validate() ────────────────────────────────────────────────────────────

  describe('validate()', () => {
    it('returns the parsed value when data matches the schema', () => {
      const result = service.validate(UserSchema, { id: 'u1', age: 25 }, 'UserV1');
      expect(result).toEqual({ id: 'u1', age: 25 });
    });

    it('applies Zod transforms and returns the transformed value', () => {
      const result = service.validate(NormalisedSchema, { name: '  Alice  ' }, 'NormV1');
      expect(result.name).toBe('alice');
    });

    it('throws ContractViolationException when data violates the schema', () => {
      expect(() => service.validate(UserSchema, { id: '', age: -1 }, 'UserV1')).toThrow(
        ContractViolationException,
      );
    });

    it('exception message includes the contract name', () => {
      try {
        service.validate(UserSchema, { id: 123, age: 'not-a-number' }, 'MyContractV1');
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ContractViolationException);
        expect((err as Error).message).toContain('MyContractV1');
      }
    });

    it('exception message includes the field path for nested violations', () => {
      try {
        service.validate(NestedSchema, { user: { email: 'not-an-email' } }, 'NestedV1');
        fail('expected to throw');
      } catch (err) {
        expect((err as Error).message).toContain('user.email');
      }
    });

    it('formats multiple issues in one exception message', () => {
      try {
        service.validate(UserSchema, { id: '', age: -5 }, 'UserV1');
        fail('expected to throw');
      } catch (err) {
        const msg = (err as Error).message;
        // Both field violations should appear, separated by '; '
        expect(msg).toContain('id');
        expect(msg).toContain('age');
      }
    });

    it('returns HTTP 422 status code on violation', () => {
      try {
        service.validate(UserSchema, {}, 'UserV1');
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ContractViolationException);
        expect((err as ContractViolationException).getStatus()).toBe(422);
      }
    });

    it('accepts extra keys that Zod strips by default (passthrough)', () => {
      // Zod strips unknown keys by default — validate should succeed with extra fields
      const result = service.validate(UserSchema, { id: 'u1', age: 30, extra: 'field' }, 'UserV1');
      expect(result).toEqual({ id: 'u1', age: 30 }); // extra stripped
    });
  });

  // ── validateSafe() ────────────────────────────────────────────────────────

  describe('validateSafe()', () => {
    it('returns the parsed value when data is valid', () => {
      const result = service.validateSafe(UserSchema, { id: 'u1', age: 10 }, 'UserV1');
      expect(result).toEqual({ id: 'u1', age: 10 });
    });

    it('returns null (not throws) when data is invalid', () => {
      const result = service.validateSafe(UserSchema, { id: '', age: -1 }, 'UserV1');
      expect(result).toBeNull();
    });

    it('returns null for completely wrong type', () => {
      expect(service.validateSafe(UserSchema, null, 'UserV1')).toBeNull();
      expect(service.validateSafe(UserSchema, 'not-an-object', 'UserV1')).toBeNull();
      expect(service.validateSafe(UserSchema, 42, 'UserV1')).toBeNull();
    });

    it('applies transforms on success', () => {
      const result = service.validateSafe(NormalisedSchema, { name: '  BOB  ' }, 'NormV1');
      expect(result?.name).toBe('bob');
    });

    it('does not throw on schema with nested violation', () => {
      expect(() =>
        service.validateSafe(NestedSchema, { user: { email: 'bad' } }, 'NestedV1'),
      ).not.toThrow();
    });
  });

  // ── filterValid() ─────────────────────────────────────────────────────────

  describe('filterValid()', () => {
    const valid1: User = { id: 'u1', age: 20 };
    const valid2: User = { id: 'u2', age: 30 };
    const invalid1 = { id: '', age: -1 };
    const invalid2 = { id: 'u3', age: 'not-a-number' };

    it('returns all items when all are valid', () => {
      const result = service.filterValid(UserSchema, [valid1, valid2], 'UserV1');
      expect(result).toHaveLength(2);
      expect(result).toEqual([valid1, valid2]);
    });

    it('drops invalid items and keeps valid ones', () => {
      const result = service.filterValid(
        UserSchema,
        [valid1, invalid1, valid2, invalid2],
        'UserV1',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(valid1);
      expect(result[1]).toEqual(valid2);
    });

    it('returns empty array when all items are invalid', () => {
      const result = service.filterValid(UserSchema, [invalid1, invalid2], 'UserV1');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty input without throwing', () => {
      const result = service.filterValid(UserSchema, [], 'UserV1');
      expect(result).toEqual([]);
    });

    it('preserves the order of valid items', () => {
      const items = [valid2, invalid1, valid1];
      const result = service.filterValid(UserSchema, items, 'UserV1');
      expect(result[0]).toEqual(valid2);
      expect(result[1]).toEqual(valid1);
    });

    it('applies transforms to each valid item', () => {
      // Use UserSchema (which has int/min constraints) so the invalid item truly fails
      const result = service.filterValid(
        UserSchema,
        [
          { id: 'u1', age: 5 },
          { id: '', age: -1 },
          { id: 'u2', age: 10 },
        ],
        'UserV1',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'u1', age: 5 });
      expect(result[1]).toEqual({ id: 'u2', age: 10 });
    });

    it('handles a single invalid item gracefully', () => {
      const result = service.filterValid(UserSchema, [invalid1], 'UserV1');
      expect(result).toEqual([]);
    });

    it('does not mutate the original items array', () => {
      const items = [valid1, invalid1];
      service.filterValid(UserSchema, items, 'UserV1');
      expect(items).toHaveLength(2); // unchanged
    });
  });

  // ── Real contract schemas integration ─────────────────────────────────────

  describe('with production ContentResultContractV1', () => {
    // Verify the new degradation fields work correctly with the registry
    const { ContentResultContractV1 } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./v1/queue/job-state.contract') as typeof import('./v1/queue/job-state.contract');

    const validResult = {
      raw: 'draft content',
      optimized: 'optimized content',
      seoKeywords: ['kw1', 'kw2'],
      readabilityScore: 75,
      toneAnalysis: { detected: 'TECHNICAL', confidence: 0.9, scores: {} },
      wordCount: 100,
      citations: ['file.pdf'],
    };

    it('validates a clean result without degradation fields', () => {
      const parsed = service.validate(ContentResultContractV1, validResult, 'ContentResultV1');
      expect(parsed.degraded).toBe(false); // default applied
      expect(parsed.degradationReasons).toEqual([]); // default applied
    });

    it('validates a degraded result with reasons', () => {
      const degraded = {
        ...validResult,
        degraded: true,
        degradationReasons: ['rag_timeout', 'optional_agent_skipped'],
      };
      const parsed = service.validate(ContentResultContractV1, degraded, 'ContentResultV1');
      expect(parsed.degraded).toBe(true);
      expect(parsed.degradationReasons).toEqual(['rag_timeout', 'optional_agent_skipped']);
    });

    it('rejects a result with an invalid readabilityScore', () => {
      expect(() =>
        service.validate(
          ContentResultContractV1,
          { ...validResult, readabilityScore: 101 },
          'ContentResultV1',
        ),
      ).toThrow(ContractViolationException);
    });
  });
});
