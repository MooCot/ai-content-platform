import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import { RAGService } from './services/rag.service';
import { SearchQueryDto } from './dto/rag.dto';

@ApiTags('rag')
@Controller('brands/:brandId/rag')
export class RAGController {
  constructor(private readonly ragService: RAGService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a document for RAG ingestion' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'brandId', type: String })
  async upload(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const doc = await this.ragService.ingest(
      brandId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return {
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      message: 'Document accepted for processing',
    };
  }

  @Get('documents')
  @ApiOperation({ summary: 'List all documents for a brand' })
  async listDocuments(@Param('brandId', ParseUUIDPipe) brandId: string) {
    return this.ragService.listDocuments(brandId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Semantic search over brand documents' })
  async search(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Query() dto: SearchQueryDto,
  ) {
    return this.ragService.search(brandId, dto.query, dto.limit);
  }

  @Delete(':docId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and its embeddings' })
  async deleteDocument(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    await this.ragService.deleteDocument(docId, brandId);
  }
}
