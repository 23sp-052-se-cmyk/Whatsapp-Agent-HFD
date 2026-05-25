import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BoardService } from './board.service';

@UseGuards(JwtAuthGuard)
@Controller('board')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get('inbox')
  getInbox(@Query() _query: unknown) {
    return this.boardService.getInbox();
  }

  @Get('pipeline')
  getPipeline(@Query('channelId') _channelId?: string) {
    return this.boardService.getPipeline();
  }

  @Patch('pipeline/:conversationId')
  moveStage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: unknown,
  ) {
    return this.boardService.moveStage(conversationId, body as string);
  }
}
