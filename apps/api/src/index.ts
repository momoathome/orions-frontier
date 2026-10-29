import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db/index.js';
import { runWorldTick, startSimulationScheduler } from './services/simulation.service.js';
import { seedAsteroidWorld, seedDevUser } from './seed.js';
import { seedBotsForOccupiedSectors } from './services/bot/bot-provision.service.js';
import { runMigrations } from './lib/db/migrate.js';
import { parseEnv } from './lib/env.js';

export const start = async () => {
  try {
    process.loadEnvFile();
  } catch {
    // Docker and production environments inject variables directly.
  }

  try {
    const env = parseEnv();
    process.env['NODE_ENV'] = env.NODE_ENV;

    // Initialize database
    await initDb();
    logger.info('Database connected');

    // Run migrations before any seeding or queries
    await runMigrations();
    logger.info('Migrations applied');

    await seedAsteroidWorld();
    logger.info('Asteroid world seeded');

    if (env.NODE_ENV === 'development') {
      await seedDevUser();
      logger.info('Dev user seeded');
    }

    await seedBotsForOccupiedSectors();
    logger.info('World bots seeded');

    const fastify = await buildApp();

    // Complete overdue work before accepting traffic, then poll PostgreSQL.
    await runWorldTick();
    const simulationScheduler = startSimulationScheduler();
    fastify.addHook('onClose', async () => {
      clearInterval(simulationScheduler);
    });

    // Start server
    await fastify.listen({ port: env.API_PORT, host: env.API_HOST });
    fastify.log.info(`🚀 API server is running on http://${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (import.meta.main) void start();
