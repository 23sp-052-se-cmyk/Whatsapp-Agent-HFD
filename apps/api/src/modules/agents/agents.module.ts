import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { DigestSchedulerService } from './digest-scheduler.service';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, DigestSchedulerService],
  exports: [AgentsService],
})
export class AgentsModule {}
