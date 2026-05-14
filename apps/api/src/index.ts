import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import env from '@fastify/env';
import autoload from '@fastify/autoload';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { envSchema } from './config/env.js';
import { errorHandler } from './plugins/error-handler.js';
import jwtPlugin from './plugins/jwt.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db/index.js';
import { initRedis } from './lib/redis.js';
import { startActionWorker } from './queue/workers/action-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      origin: process.env['CORS_ORIGIN'] || '*',
      credentials: true,
    });

    // Custom plugins
    await fastify.register(errorHandler);
    await fastify.register(jwtPlugin);

    // Initialize database
    await initDb();
    fastify.log.info('Database connected');

    // Initialize Redis
    await initRedis();
    fastify.log.info('Redis connected');

    // Start job queue workers
    startActionWorker();
    fastify.log.info('Queue workers started');

    // File-based routing with AutoLoad
    await fastify.register(autoload, {
      dir: join(__dirname, 'routes'),
      options: {
        prefix: '/api',
      },
      dirNameRoutePrefix: true,
      routeParams: true,
      ignorePattern: /.*(test|spec).ts/,
    });

    // Start server
    const port = Number(process.env['API_PORT']) || 3000;
    const host = process.env['API_HOST'] || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`🚀 API server is running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
