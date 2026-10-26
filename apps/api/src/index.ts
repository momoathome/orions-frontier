import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db/index.js';
import { runWorldTick, startSimulationScheduler } from './services/simulation.service.js';
import { seedAsteroidWorld, seedDevUser } from './lib/seed.js';
import { seedBotsForOccupiedSectors } from './services/bot/bot-provision.service.js';
import { runMigrations } from './lib/db/migrate.js';

export const start = async () => {
  try {
    process.loadEnvFile();
  } catch {
    // Docker and production environments inject variables directly.
  }
  process.env['NODE_ENV'] ??= 'production';

  try {
    for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
      if (!process.env[key]) throw new Error(`${key} is not defined`);
    }

    // Initialize database
    await initDb();
    logger.info('Database connected');

    // Run migrations before any seeding or queries
    await runMigrations();
    logger.info('Migrations applied');

    await seedAsteroidWorld();
    logger.info('Asteroid world seeded');

    if (process.env['NODE_ENV'] === 'development') {
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
    const port = Number(process.env['API_PORT']) || 3000;
    const host = process.env['API_HOST'] || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`🚀 API server is running on http://${host}:${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (import.meta.main) void start();
