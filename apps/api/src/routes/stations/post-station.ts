import { z } from 'zod';
import { getDb } from '../../lib/db/index.js';
import { stations } from '../../lib/db/schema/stations.js';
import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { seedStationResources } from '../../services/station-resource.service.js';
import { seedStationBuildings } from '../../services/building.service.js';

const CreateStationSchema = z.object({
  name: z.string().min(1).max(128),
  x: z.number().int(),
  y: z.number().int(),
});

/**
 * POST /api/stations
 * Creates a new station for the authenticated user and seeds initial resources.
 */
export default defineRoute(async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateStationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, message: 'Invalid request body' });
    }

    const { name, x, y } = parsed.data;
    const db = getDb();

    const [station] = await db
      .insert(stations)
      .values({ userId: request.user.userId, name, x, y })
      .returning();

    await seedStationResources(station!.id);
    await seedStationBuildings(station!.id);

    return reply.status(201).send({
      success: true,
      data: {
        id: station!.id,
        userId: station!.userId,
        name: station!.name,
        x: station!.x,
        y: station!.y,
        createdAt: station!.createdAt.toISOString(),
      },
    });
  });
});
