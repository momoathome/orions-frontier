import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getVisibleWorldMovements, parseChunkRange } from '../../../services/world.service.js';

// At the minimum map zoom a desktop viewport spans considerably more than the
// 20 chunks used by static chunk batches. Active trips are already fetched as
// one small world projection, so a wider viewport does not multiply DB work.
const MAX_CHUNK_RANGE = 100;

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const movements = await getVisibleWorldMovements(
      parseChunkRange(request.query, MAX_CHUNK_RANGE),
      request.user.userId
    );
    request.log.debug(
      {
        ownTrips: movements.filter(({ kind }) => kind === 'own_trip').length,
        radarContacts: movements.filter(({ kind }) => kind === 'radar_contact').length,
      },
      'Projected scanner-visible world movements'
    );
    return movements;
  });
}) satisfies FastifyPluginAsync;
