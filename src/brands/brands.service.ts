import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrandEntity, BrandConfig } from './entities/brand.entity';
import { CreateBrandDto, UpdateBrandConfigDto } from './dto/brand.dto';
import { BrandNotFoundException } from '../common/exceptions/domain.exceptions';
import { Tone, LLMProvider } from '../common/types/domain.types';

@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(BrandEntity)
    private readonly brandRepo: Repository<BrandEntity>,
  ) {}

  async create(dto: CreateBrandDto): Promise<BrandEntity> {
    const config: BrandConfig = {
      defaultTone: dto.config.defaultTone,
      allowedModels: dto.config.allowedModels,
      preferredProvider: dto.config.preferredProvider,
      ragEnabled: dto.config.ragEnabled ?? true,
      systemPrompt: dto.config.systemPrompt ?? this.defaultSystemPrompt(dto.name),
      maxContentLength: dto.config.maxContentLength ?? 2000,
    };

    const brand = this.brandRepo.create({
      slug: dto.slug,
      name: dto.name,
      config,
    });

    return this.brandRepo.save(brand);
  }

  async findById(id: string): Promise<BrandEntity> {
    const brand = await this.brandRepo.findOne({ where: { id, isActive: true } });
    if (!brand) throw new BrandNotFoundException(id);
    return brand;
  }

  async findBySlug(slug: string): Promise<BrandEntity> {
    const brand = await this.brandRepo.findOne({ where: { slug, isActive: true } });
    if (!brand) throw new BrandNotFoundException(slug);
    return brand;
  }

  async findAll(): Promise<BrandEntity[]> {
    return this.brandRepo.find({ where: { isActive: true }, order: { createdAt: 'DESC' } });
  }

  async updateConfig(id: string, dto: UpdateBrandConfigDto): Promise<BrandEntity> {
    const brand = await this.findById(id);
    brand.config = {
      ...brand.config,
      ...dto.config,
    };
    return this.brandRepo.save(brand);
  }

  async deactivate(id: string): Promise<void> {
    const brand = await this.findById(id);
    brand.isActive = false;
    await this.brandRepo.save(brand);
  }

  private defaultSystemPrompt(brandName: string): string {
    return `You are a professional content writer for ${brandName}. Write clear, engaging, and accurate content that represents the brand's values. Always maintain brand consistency and focus on providing value to the audience.`;
  }
}
