import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import {
  getStationResources,
  getDeliveredResourceRates,
  getStationStorageCapacity,
} from '../../services/station-resource.service.js';
import { defineRoute } from '../../lib/route.js';

const QuerySchema = z.object({ stationId: z.uuid() });

export default defineRoute(async (app) => {
  app.get(
    '/resources',
    { onRequest: [authenticate], schema: { querystring: QuerySchema } },
    async (request) => {
      const { userId } = request.user;
      const { stationId } = request.query;
      const [resources, rates, storageCapacity] = await Promise.all([
        getStationResources(userId, stationId),
        getDeliveredResourceRates(userId, stationId),
        getStationStorageCapacity(stationId),
      ]);

      return { resources, rates, storageCapacity };
    }
  );
});
