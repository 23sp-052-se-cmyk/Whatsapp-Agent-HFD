import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AgentsService } from './agents.service';
import type { AuthenticatedUser } from '@repo/shared';

const AgentDraftSchema = z.object({
  businessName: z.string().min(1).max(160),
  businessDescription: z.string().max(2000).optional().default(''),
  tone: z.string().min(1).max(80).default('friendly'),
  intention: z.string().max(1000).optional().default(''),
  systemPrompt: z.string().min(20).max(8000),
  guardrails: z.string().max(3000).optional().default(''),
  replyLangPolicy: z.enum(['auto', 'en', 'ur', 'roman_urdu']).default('auto'),
});

const AgentTestSchema = z.object({
  message: z.string().min(1).max(2000),
  draft: AgentDraftSchema.optional(),
});

const SummarySettingsSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1).max(80).default('Asia/Karachi'),
  recipientPhone: z.string().min(6).max(32),
  enabled: z.boolean().default(true),
});

@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get('versions')
  listVersions(@Request() req: { user: AuthenticatedUser }) {
    return this.agentsService.listVersions(req.user.orgId);
  }

  @Get('active')
  getActive(@Request() req: { user: AuthenticatedUser }) {
    return this.agentsService.getActive(req.user.orgId);
  }

  @Post('drafts')
  createDraft(@Request() req: { user: AuthenticatedUser }, @Body() body: unknown) {
    const parsed = AgentDraftSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.agentsService.createDraft(req.user.orgId, parsed.data);
  }

  @Post('test')
  testReply(@Request() req: { user: AuthenticatedUser }, @Body() body: unknown) {
    const parsed = AgentTestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.agentsService.testReply(req.user.orgId, parsed.data);
  }

  @Get('summary-settings')
  getSummarySettings(@Request() req: { user: AuthenticatedUser }) {
    return this.agentsService.getSummarySettings(req.user.orgId, req.user.sub);
  }

  @Post('summary-settings')
  saveSummarySettings(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: unknown,
  ) {
    const parsed = SummarySettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.agentsService.saveSummarySettings(
      req.user.orgId,
      req.user.sub,
      parsed.data,
    );
  }

  @Get(':id')
  getVersion(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agentsService.getVersion(req.user.orgId, id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agentsService.publish(req.user.orgId, id);
  }
}
