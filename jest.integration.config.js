/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@brands/(.*)$': '<rootDir>/src/brands/$1',
    '^@content/(.*)$': '<rootDir>/src/content/$1',
    '^@rag/(.*)$': '<rootDir>/src/rag/$1',
    '^@agents/(.*)$': '<rootDir>/src/agents/$1',
    '^@llm/(.*)$': '<rootDir>/src/llm/$1',
    '^@tools/(.*)$': '<rootDir>/src/tools/$1',
    '^@streaming/(.*)$': '<rootDir>/src/streaming/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
  },
  testTimeout: 60000,
  verbose: true,
};
