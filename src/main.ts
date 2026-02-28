import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import * as swaggerUi from 'swagger-ui-express';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // URI versioning: all routes prefixed with /v1/ by default
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1'
  });

  // Swagger UI — serves the existing openapi.yaml at /api (unversioned)
  const specPath = path.join(process.cwd(), 'docs', 'openapi.yaml');
  const swaggerDocument = yaml.load(fs.readFileSync(specPath, 'utf8')) as object;
  app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customSiteTitle: 'Fintech Core Engine API'
  }));

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
