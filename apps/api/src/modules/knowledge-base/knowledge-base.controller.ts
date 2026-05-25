import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { KnowledgeBaseService } from './knowledge-base.service';
import type { AuthenticatedUser } from '@repo/shared';

const CreateKnowledgeItemSchema = z.object({
  title: z.string().min(2).max(160),
  sourceType: z
    .enum(['faq', 'manual', 'txt', 'url', 'pdf', 'docx', 'csv'])
    .default('manual'),
  text: z.string().min(2).max(20_000),
});

@UseGuards(JwtAuthGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Get('items')
  findAll(@Request() req: { user: AuthenticatedUser }) {
    return this.kbService.findAll(req.user.orgId);
  }

  @Post('items')
  create(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: unknown,
  ) {
    const parsed = CreateKnowledgeItemSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.kbService.create(req.user.orgId, parsed.data);
  }

  @Post('import-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async importFile(
    @Request() req: { user: AuthenticatedUser },
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype?: string } | undefined,
  ) {
    if (!file) throw new BadRequestException('File is required');

    try {
      return await this.kbService.importFile(req.user.orgId, file);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'File import failed',
      );
    }
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kbService.remove(req.user.orgId, id);
  }
}
