import { eq } from 'drizzle-orm';
import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { getDb } from '../../lib/db/index.js';
import { stations } from '../../lib/db/schema/stations.js';
import type { Station } from '@orions-frontier/shared';

/**
 * GET /stations
 * Returns all stations belonging to the authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const db = getDb();

    const rows = await db
      .select()
      .from(stations)
      .where(eq(stations.userId, request.user.userId));

    const data: Station[] = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      x: row.x,
      y: row.y,
      createdAt: row.createdAt.toISOString(),
    }));

    return reply.send({ success: true, data });
  });
});
