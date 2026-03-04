import {
  IsString,
  IsEnum,
  IsArray,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Tone, LLMProvider } from '../../common/types/domain.types';

export class BrandConfigDto {
  @ApiProperty({ enum: Tone })
  @IsEnum(Tone)
  defaultTone!: Tone;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  allowedModels!: string[];

  @ApiProperty({ enum: LLMProvider })
  @IsEnum(LLMProvider)
  preferredProvider!: LLMProvider;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ragEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  systemPrompt?: string;

  @ApiPropertyOptional({ default: 2000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10000)
  maxContentLength?: number;
}

export class CreateBrandDto {
  @ApiProperty({ description: 'URL-safe slug, e.g. "acme-corp"' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: BrandConfigDto })
  @ValidateNested()
  @Type(() => BrandConfigDto)
  config!: BrandConfigDto;
}

export class UpdateBrandConfigDto {
  @ApiProperty({ type: BrandConfigDto })
  @ValidateNested()
  @Type(() => BrandConfigDto)
  config!: BrandConfigDto;
}
