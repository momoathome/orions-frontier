import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { createStation } from '../../services/station/index.js';
import { seedBotsForSector } from '../../services/bot/index.js';
import { defineRoute } from '../../lib/route.js';

const CreateStationSchema = z.object({
  name: z.string().trim().min(1).max(128),
});

/**
 * POST /api/stations
 * Creates a new station for the authenticated user and seeds initial resources.
 */
export default defineRoute(async (app) => {
  app.post(
    '/',
    { onRequest: [authenticate], schema: { body: CreateStationSchema } },
    async (request, reply) => {
      const { name } = request.body;
      const station = await createStation(request.user.userId, { name });
      void seedBotsForSector(station.sectorId).catch((error: unknown) => {
        app.log.error({ error, sectorId: station.sectorId }, 'Failed to provision sector bots');
      });

      return reply.status(201).send(station);
    }
  );
});
