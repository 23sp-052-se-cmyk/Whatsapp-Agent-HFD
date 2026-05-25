import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from '@repo/shared';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  orgName: z.string().min(2).max(100),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) {
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.authService.register(
      parsed.data.email,
      parsed.data.password,
      parsed.data.orgName,
    );
  }

  @Post('login')
  login(@Body() body: unknown) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.authService.login(parsed.data.email, parsed.data.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: AuthenticatedUser }) {
    return this.authService.getProfile(req.user.sub);
  }
}
