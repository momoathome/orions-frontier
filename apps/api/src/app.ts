import autoload from '@fastify/autoload';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { join } from 'node:path';
import { constants as zlib } from 'node:zlib';
import { trustProxySchema } from './lib/env.js';
import { logger } from './lib/logger.js';
import { attachRealtimeServer } from './lib/realtime.js';
import { errorHandler } from './plugins/error-handler.js';
import { findUserById } from './services/auth/index.js';

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
    // Behind a proxy, rate limits key on the client's address instead of the proxy's.
    trustProxy: trustProxySchema.parse(process.env['TRUST_PROXY']),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // The API answers JSON only, so nothing may load or frame it; the app's CSP is in vite.config.ts.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  // Map chunks are large, repetitive JSON; brotli 4 shrinks them several times at little CPU.
  await app.register(compress, {
    threshold: 1_024,
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
  });
  // Opt-in per route (`config.rateLimit`); only the credential endpoints need it today.
  await app.register(rateLimit, { global: false });
  await app.register(cors, {
    // parseEnv requires CORS_ORIGIN in production; reflecting any origin is for local use only.
    // Bearer tokens, no cookies: credentials stay off.
    origin: process.env['CORS_ORIGIN'] || true,
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

  if (options.realtime !== false) {
    attachRealtimeServer(app, async (userId) => {
      const user = await findUserById(userId);
      return user?.status === 'active' ? user.role : null;
    });
  }
  return app;
}
