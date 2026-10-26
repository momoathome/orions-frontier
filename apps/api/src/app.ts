import autoload from '@fastify/autoload';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { join } from 'node:path';
import { logger } from './lib/logger.js';
import { attachRealtimeServer } from './lib/realtime.js';
import { errorHandler } from './plugins/error-handler.js';

export async function buildApp(
  options: {
    jwtSecret?: string;
    logger?: boolean;
    realtime?: boolean;
  } = {}
) {
  const jwtSecret = options.jwtSecret ?? process.env['JWT_SECRET'];
  if (!jwtSecret) throw new Error('JWT_SECRET is not defined');

  const app = Fastify({
    loggerInstance: options.logger === false ? logger.child({}, { level: 'silent' }) : logger,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] || true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  app.setErrorHandler(errorHandler);
  await app.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d' },
  });
  await app.register(autoload, {
    dir: join(import.meta.dirname, 'routes'),
    options: { prefix: '/api' },
    dirNameRoutePrefix: true,
    routeParams: true,
    ignorePattern: /.*(test|spec).ts/,
  });

  if (options.realtime !== false) attachRealtimeServer(app);
  return app;
}
