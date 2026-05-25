import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

type RawBodyRequest = Request & { body: Buffer };

@Controller('stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature?: string,
  ) {
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!webhookSecret || webhookSecret === 'whsec_...') {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing Stripe signature');
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));

    this.verifySignature(rawBody, signature, webhookSecret);

    let event: { id?: string; type?: string };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid Stripe event payload');
    }

    this.logger.log(`Received Stripe event ${event.type ?? 'unknown'} (${event.id ?? 'no-id'})`);

    return { received: true };
  }

  private verifySignature(rawBody: Buffer, header: string, secret: string) {
    const parts = header.split(',').reduce<Record<string, string[]>>((acc, item) => {
      const [key, value] = item.split('=');
      if (!key || !value) return acc;
      acc[key] = [...(acc[key] ?? []), value];
      return acc;
    }, {});

    const timestamp = parts['t']?.[0];
    const signatures = parts['v1'] ?? [];

    if (!timestamp || signatures.length === 0) {
      throw new UnauthorizedException('Invalid Stripe signature header');
    }

    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');

    const isValid = signatures.some((candidate) => {
      const expectedBuffer = Buffer.from(expected, 'hex');
      const candidateBuffer = Buffer.from(candidate, 'hex');
      return (
        expectedBuffer.length === candidateBuffer.length &&
        timingSafeEqual(expectedBuffer, candidateBuffer)
      );
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid Stripe signature');
    }
  }
}
