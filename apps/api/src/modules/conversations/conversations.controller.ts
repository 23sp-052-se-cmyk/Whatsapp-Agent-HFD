import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ConversationsService } from './conversations.service';
import { SendMessageSchema } from './dto/send-message.dto';
import { UpdateConversationSchema } from './dto/update-conversation.dto';
import type { AuthenticatedUser } from '@repo/shared';

const CreateConversationSchema = z.object({
  channelId: z.string().uuid(),
  waId: z.string().min(3).max(64),
  name: z.string().min(1).max(120).optional(),
});

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findAll(
    @Request() req: { user: AuthenticatedUser },
    @Query('channelId') channelId?: string,
  ) {
    return this.conversationsService.findAll(req.user.orgId, channelId);
  }

  @Post()
  create(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: unknown,
  ) {
    const parsed = CreateConversationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.conversationsService.create(req.user.orgId, parsed.data);
  }

  @Get(':id')
  findOne(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationsService.findOne(req.user.orgId, id);
  }

  @Patch(':id')
  update(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = UpdateConversationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.conversationsService.update(req.user.orgId, id, parsed.data);
  }

  @Get(':id/messages')
  findMessages(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationsService.findMessages(req.user.orgId, id);
  }

  @Post(':id/messages')
  sendMessage(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.conversationsService.sendMessage(req.user.orgId, id, parsed.data);
  }
}
