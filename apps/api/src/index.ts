import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import autoload from '@fastify/autoload';
import fastifyJwt from '@fastify/jwt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { errorHandler } from './plugins/error-handler.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db/index.js';
import { attachRealtimeServer } from './lib/realtime.js';
import { runWorldTick, startSimulationScheduler } from './services/simulation.service.js';
import { seedAsteroidWorld, seedDevUser } from './lib/seed.js';
import { seedBotsForOccupiedSectors } from './services/bot/bot-provision.service.js';
import { runMigrations } from './lib/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const start = async () => {
  try {
    process.loadEnvFile();
  } catch {
    // Docker and production environments inject variables directly.
  }
  process.env['NODE_ENV'] ??= 'production';

  const fastify = Fastify({
    loggerInstance: logger,
  });

  try {
    for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
      if (!process.env[key]) throw new Error(`${key} is not defined`);
    }

    // Security plugins
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
    });

    await fastify.register(cors, {
      origin: process.env['CORS_ORIGIN'] || true,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    });

    fastify.setErrorHandler(errorHandler);
    await fastify.register(fastifyJwt, {
      secret: process.env['JWT_SECRET']!,
      sign: { expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d' },
    });

    // Initialize database
    await initDb();
    fastify.log.info('Database connected');

    // Run migrations before any seeding or queries
    await runMigrations();
    fastify.log.info('Migrations applied');

    await seedAsteroidWorld();
    fastify.log.info('Asteroid world seeded');

    if (process.env['NODE_ENV'] === 'development') {
      await seedDevUser();
      fastify.log.info('Dev user seeded');
    }

    await seedBotsForOccupiedSectors();
    fastify.log.info('World bots seeded');

    // Complete overdue work before accepting traffic, then poll PostgreSQL.
    await runWorldTick();
    const simulationScheduler = startSimulationScheduler();
    fastify.addHook('onClose', async () => clearInterval(simulationScheduler));

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

    attachRealtimeServer(fastify);

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
