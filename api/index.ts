import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../apps/server/src/app.module';
import { TrpcRouter } from '../apps/server/src/trpc/trpc.router';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, Request, Response } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigurationType } from '../apps/server/src/configuration';
import { join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import * as express from 'express';

let app: any;

async function bootstrap() {
  if (app) return app;

  const server = express();

  const packageJsonPath = resolve(__dirname, '../apps/server/package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const appVersion = packageJson.version;
    console.log('appVersion: v' + appVersion);
  }

  const application = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  const configService = application.get(ConfigService);

  const { host, port } =
    configService.get<ConfigurationType['server']>('server')! || {
      host: '0.0.0.0',
      port: 3000,
    };

  application.use(json({ limit: '10mb' }));
  application.use(urlencoded({ extended: true, limit: '10mb' }));

  const clientPath = resolve(__dirname, '../apps/server/dist/client');
  if (existsSync(clientPath)) {
    application.useStaticAssets(join(clientPath, 'assets'), {
      prefix: '/dash/assets/',
    });
    application.setBaseViewsDir(clientPath);
    application.setViewEngine('hbs');
  }

  application.enable('trust proxy');

  application.enableCors({
    exposedHeaders: ['authorization'],
    origin: true,
    credentials: true,
  });

  const trpc = application.get(TrpcRouter);
  trpc.applyMiddleware(application);

  await application.init();

  app = server;
  return app;
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req: Request, res: Response) {
  try {
    const server = await bootstrap();
    server(req, res);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
