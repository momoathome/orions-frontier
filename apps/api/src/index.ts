import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import env from '@fastify/env';
import { envSchema } from './config/env.js';
import { errorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db/index.js';
import { initRedis } from './lib/redis.js';

const start = async () => {
  const fastify = Fastify({
    logger: logger,
  });

  try {
    // Environment validation
    await fastify.register(env, {
      schema: envSchema,
      dotenv: true,
    });

    // Security plugins
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
    });

    await fastify.register(cors, {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    });

    // Custom plugins
    await fastify.register(errorHandler);

    // Initialize database
    await initDb();
    fastify.log.info('Database connected');

    // Initialize Redis
    await initRedis();
    fastify.log.info('Redis connected');

    // Register routes
    await fastify.register(healthRoutes, { prefix: '/api/v1' });

    // Start server
    const port = Number(process.env.API_PORT) || 3000;
    const host = process.env.API_HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`🚀 API server is running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
