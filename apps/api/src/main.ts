import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();

  app.use('/stripe/webhook', raw({ type: 'application/json' }));
  app.use(json());
  app.use(urlencoded({ extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>('CORS_ORIGIN', '*');
  app.enableCors({ origin: corsOrigin === '*' ? true : corsOrigin });

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'stripe/webhook', method: RequestMethod.POST }],
  });

  const port = process.env['PORT'] ?? config.get<string>('API_PORT', '5000');
  await app.listen(port, '0.0.0.0');
  console.log(`API running on port ${port}`);
}
bootstrap();
