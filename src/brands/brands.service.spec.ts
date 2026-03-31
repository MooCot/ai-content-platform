import { Repository } from 'typeorm';
import { BrandsService } from './brands.service';
import { BrandEntity } from './entities/brand.entity';
import { BrandNotFoundException } from '../common/exceptions/domain.exceptions';
import { Tone, LLMProvider } from '../common/types/domain.types';
import { createRepositoryMock, MockRepository } from '../../test/utils/repository.mock';
import { createBrandFixture } from '../../test/fixtures/brand.fixture';

describe('BrandsService', () => {
  let service: BrandsService;
  let repo: MockRepository<BrandEntity>;

  const baseDto = {
    slug: 'acme',
    name: 'Acme Corp',
    config: {
      defaultTone: Tone.FORMAL,
      allowedModels: ['claude-sonnet-4-6'],
      preferredProvider: LLMProvider.CLAUDE,
    },
  };

  beforeEach(() => {
    repo = createRepositoryMock<BrandEntity>();
    service = new BrandsService(repo as unknown as Repository<BrandEntity>);
  });

  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('calls repo.create and repo.save with the built entity', async () => {
      const brand = createBrandFixture({ slug: 'acme', name: 'Acme Corp' });
      repo.save.mockResolvedValue(brand);

      await service.create(baseDto);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('passes slug and name to repo.create', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create(baseDto);
      const created = repo.create.mock.calls[0][0];
      expect(created.slug).toBe('acme');
      expect(created.name).toBe('Acme Corp');
    });

    it('defaults ragEnabled to true when not provided', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create(baseDto);
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.ragEnabled).toBe(true);
    });

    it('uses provided ragEnabled: false when explicitly set', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create({ ...baseDto, config: { ...baseDto.config, ragEnabled: false } });
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.ragEnabled).toBe(false);
    });

    it('defaults maxContentLength to 2000 when not provided', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create(baseDto);
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.maxContentLength).toBe(2000);
    });

    it('uses provided maxContentLength when set', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create({ ...baseDto, config: { ...baseDto.config, maxContentLength: 5000 } });
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.maxContentLength).toBe(5000);
    });

    it('generates a default systemPrompt containing the brand name when not provided', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      await service.create(baseDto);
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.systemPrompt).toContain('Acme Corp');
    });

    it('uses the provided systemPrompt when set', async () => {
      repo.save.mockResolvedValue(createBrandFixture());
      const customPrompt = 'Write concise marketing copy.';
      await service.create({
        ...baseDto,
        config: { ...baseDto.config, systemPrompt: customPrompt },
      });
      const created = repo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.config.systemPrompt).toBe(customPrompt);
    });

    it('returns the saved entity', async () => {
      const brand = createBrandFixture({ slug: 'acme' });
      repo.save.mockResolvedValue(brand);
      const result = await service.create(baseDto);
      expect(result).toBe(brand);
    });
  });

  // ── findById() ────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('queries with id and isActive: true', async () => {
      const brand = createBrandFixture({ id: 'uuid-1' });
      repo.findOne.mockResolvedValue(brand);
      await service.findById('uuid-1');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1', isActive: true } });
    });

    it('returns the brand when found', async () => {
      const brand = createBrandFixture({ id: 'uuid-1' });
      repo.findOne.mockResolvedValue(brand);
      const result = await service.findById('uuid-1');
      expect(result).toBe(brand);
    });

    it('throws BrandNotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing-id')).rejects.toThrow(BrandNotFoundException);
    });
  });

  // ── findBySlug() ──────────────────────────────────────────────────────────

  describe('findBySlug()', () => {
    it('queries with slug and isActive: true', async () => {
      const brand = createBrandFixture({ slug: 'acme' });
      repo.findOne.mockResolvedValue(brand);
      await service.findBySlug('acme');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { slug: 'acme', isActive: true } });
    });

    it('throws BrandNotFoundException when slug not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findBySlug('unknown')).rejects.toThrow(BrandNotFoundException);
    });
  });

  // ── findAll() ─────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('finds only active brands ordered by createdAt DESC', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll();
      expect(repo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns the array from the repository', async () => {
      const brands = [createBrandFixture(), createBrandFixture({ id: 'brand-2', slug: 'b2' })];
      repo.find.mockResolvedValue(brands);
      const result = await service.findAll();
      expect(result).toBe(brands);
    });
  });

  // ── updateConfig() ────────────────────────────────────────────────────────

  describe('updateConfig()', () => {
    const updatedConfig = {
      defaultTone: Tone.CASUAL,
      allowedModels: ['gpt-4o'],
      preferredProvider: LLMProvider.OPENAI,
    };

    it('merges the new config over the existing config', async () => {
      const existing = createBrandFixture({ id: 'uuid-1' });
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockImplementation(async (e) => e as BrandEntity);

      const result = await service.updateConfig('uuid-1', { config: updatedConfig });

      expect(result.config.defaultTone).toBe(Tone.CASUAL);
      // Other config fields preserved (ragEnabled was set in fixture)
      expect(result.config.ragEnabled).toBe(existing.config.ragEnabled);
    });

    it('calls repo.save after updating config', async () => {
      repo.findOne.mockResolvedValue(createBrandFixture());
      repo.save.mockImplementation(async (e) => e as BrandEntity);
      await service.updateConfig('uuid-1', { config: updatedConfig });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('throws BrandNotFoundException when brand does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.updateConfig('missing', { config: updatedConfig })).rejects.toThrow(
        BrandNotFoundException,
      );
    });
  });

  // ── deactivate() ──────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('sets isActive to false and saves', async () => {
      const brand = createBrandFixture({ id: 'uuid-1', isActive: true });
      repo.findOne.mockResolvedValue(brand);
      repo.save.mockImplementation(async (e) => e as BrandEntity);

      await service.deactivate('uuid-1');

      expect(brand.isActive).toBe(false);
      expect(repo.save).toHaveBeenCalledWith(brand);
    });

    it('throws BrandNotFoundException when brand does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.deactivate('missing')).rejects.toThrow(BrandNotFoundException);
    });

    it('resolves void on success', async () => {
      repo.findOne.mockResolvedValue(createBrandFixture());
      repo.save.mockImplementation(async (e) => e as BrandEntity);
      await expect(service.deactivate('uuid-1')).resolves.toBeUndefined();
    });
  });
});
