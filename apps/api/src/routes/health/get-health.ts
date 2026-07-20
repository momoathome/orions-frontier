import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../lib/db/index.js';

/**
 * Health check endpoint
 * GET /health
 */
export default (async (app) => {
  app.get('/', async (_request, reply) => {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
      },
    };

    try {
      // Check database
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      health.services.database = 'ok';
    } catch {
      health.services.database = 'error';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(health);
  });
}) satisfies FastifyPluginAsync;
