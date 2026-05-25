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
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ChannelsService } from './channels.service';
import type { AuthenticatedUser } from '@repo/shared';

const CreateChannelSchema = z.object({
  phone: z.string().min(3).max(32).optional(),
});

const PairCodeSchema = z.object({
  phone: z.string().min(8).max(32),
});

@UseGuards(JwtAuthGuard)
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  findAll(@Request() req: { user: AuthenticatedUser }) {
    return this.channelsService.findAll(req.user.orgId);
  }

  @Post()
  create(@Request() req: { user: AuthenticatedUser }, @Body() body: unknown) {
    const parsed = CreateChannelSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.channelsService.create(req.user.orgId, parsed.data.phone);
  }

  @Get(':id/qr')
  getQr(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelsService.getLatestQr(req.user.orgId, id);
  }

  @Get(':id/pair-code')
  getPairCode(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelsService.getLatestPairCode(req.user.orgId, id);
  }

  @Get(':id')
  findOne(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelsService.findOne(req.user.orgId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelsService.remove(req.user.orgId, id);
  }

  @Post(':id/pair')
  pair(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelsService.pair(req.user.orgId, id);
  }

  @Post(':id/pair-code')
  pairCode(
    @Request() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = PairCodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.channelsService.pairWithCode(req.user.orgId, id, parsed.data.phone);
  }
}
