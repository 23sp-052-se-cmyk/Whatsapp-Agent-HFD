import { Module } from '@nestjs/common';
import { AutoReplyService } from './auto-reply.service';
import { ProactiveFollowupService } from './proactive-followup.service';

@Module({
  providers: [AutoReplyService, ProactiveFollowupService],
})
export class AutoReplyModule {}
