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
import { startSpacecraftBuildWorker } from './queue/workers/spacecraft-build-worker.js';
import { startMiningTickWorker } from './queue/workers/mining-tick-worker.js';
import { scheduleMiningTickCron } from './queue/queues/mining-tick-queue.js';
import {
  seedSpacecraftDefinitions,
  seedBuildingDefinitions,
  seedAsteroidWorld,
  seedSpawnSlots,
  seedDevUser,
} from './lib/seed.js';
import { runMigrations } from './lib/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const start = async () => {
  const fastify = Fastify({
    loggerInstance: logger,
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
      origin: process.env['CORS_ORIGIN'] || true,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    });

    // Custom plugins
    await fastify.register(errorHandler);
    await fastify.register(jwtPlugin);

    // Initialize database
    await initDb();
    fastify.log.info('Database connected');

    // Run migrations before any seeding or queries
    await runMigrations();
    fastify.log.info('Migrations applied');

    // Initialize Redis
    await initRedis();
    fastify.log.info('Redis connected');

    // Start job queue workers
    startActionWorker();
    startSpacecraftBuildWorker();
    startMiningTickWorker();
    await scheduleMiningTickCron();
    fastify.log.info('Queue workers started');

    // Seed static data
    await seedSpacecraftDefinitions();
    fastify.log.info('Spacecraft definitions seeded');

    await seedBuildingDefinitions();
    fastify.log.info('Building definitions seeded');

    await seedAsteroidWorld();
    fastify.log.info('Asteroid world seeded');

    await seedSpawnSlots();
    fastify.log.info('Spawn slots seeded');

    await seedDevUser();
    fastify.log.info('Dev user seeded');

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
