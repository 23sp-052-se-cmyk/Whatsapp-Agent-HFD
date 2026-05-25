import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { NotImplementedException } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  @Get('templates')
  getTemplates(): never {
    throw new NotImplementedException();
  }

  @Post('intake')
  saveIntake(@Body() _body: unknown): never {
    throw new NotImplementedException();
  }

  @Post('generate')
  generateAgent(@Body() _body: unknown): never {
    throw new NotImplementedException();
  }
}
