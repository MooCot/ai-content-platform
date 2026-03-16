/**
 * Creates a Jest mock for a TypeORM Repository.
 * Only stubs the methods actually used across the codebase.
 */
export function createRepositoryMock<T extends object>() {
  return {
    create: jest.fn((dto: Partial<T>) => ({ ...dto }) as T),
    save: jest.fn((entity: T) => Promise.resolve(entity)),
    find: jest.fn(() => Promise.resolve([] as T[])),
    findOne: jest.fn(() => Promise.resolve(null as T | null)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    count: jest.fn(() => Promise.resolve(0)),
  };
}

export type MockRepository<T extends object> = ReturnType<typeof createRepositoryMock<T>>;
