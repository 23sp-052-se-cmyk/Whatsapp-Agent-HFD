import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { validate } from './config/env.validation';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { BoardModule } from './modules/board/board.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { AutoReplyModule } from './modules/auto-reply/auto-reply.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', '../../.env'],
      validate,
      isGlobal: true,
    }),
    HealthModule,
    AuthModule,
    AgentsModule,
    BoardModule,
    ChannelsModule,
    ConversationsModule,
    KnowledgeBaseModule,
    OnboardingModule,
    StripeModule,
    AutoReplyModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule {}
