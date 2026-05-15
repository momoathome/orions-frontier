import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { getDb } from '../../lib/db/index.js';
import { stations } from '../../lib/db/schema/stations.js';
import type { Station } from '@orions-frontier/shared';

/**
 * GET /stations/all
 * Returns all stations in the database (admin / development use).
 */
export default defineRoute(async (app) => {
  app.get('/all', { preHandler: [authenticate] }, async (_request, reply) => {
    const db = getDb();

    const rows = await db.select().from(stations);

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
