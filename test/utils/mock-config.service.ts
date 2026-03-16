import { ConfigService } from '@nestjs/config';
import { configuration } from '../../src/common/config/configuration';

/** Singleton default config used across all unit tests. */
const DEFAULT_CONFIG = configuration();

/**
 * Returns a Jest mock of ConfigService that delegates get() to the default
 * configuration factory. Individual tests can override specific keys by
 * passing an `overrides` map.
 */
export function createMockConfigService(
  overrides: Record<string, unknown> = {},
): jest.Mocked<ConfigService> {
  const get = jest.fn((key: string) => {
    if (key in overrides) return overrides[key];

    // Walk dotted key path into the config object
    return key.split('.').reduce<unknown>((obj, part) => {
      if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[part];
      return undefined;
    }, DEFAULT_CONFIG);
  });

  return { get } as unknown as jest.Mocked<ConfigService>;
}
