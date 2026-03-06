import { IsEnum, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ContentType } from '../../common/types/domain.types';

export class GenerateContentDto {
  @ApiProperty({ description: 'Topic or title of the content to generate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  topic!: string;

  @ApiProperty({ enum: ContentType, description: 'Type of content to generate' })
  @IsEnum(ContentType)
  contentType!: ContentType;
}
