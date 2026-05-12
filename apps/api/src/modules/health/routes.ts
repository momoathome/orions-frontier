import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { getRedis } from '../../lib/redis.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_request, reply) => {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        redis: 'unknown',
      },
    };

    try {
      // Check database
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      health.services.database = 'ok';
    } catch (err) {
      health.services.database = 'error';
      health.status = 'degraded';
    }

    try {
      // Check Redis
      const redis = getRedis();
      await redis.ping();
      health.services.redis = 'ok';
    } catch (err) {
      health.services.redis = 'error';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(health);
  });
};
