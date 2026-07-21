import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import {
  getUserScannerStrength,
  getVisibleChunkAsteroids,
} from '../../../services/asteroid.service.js';
import { getVisibleChunkStations, parseChunkRange } from '../../../services/world.service.js';
import { getVisibleDebris } from '../../../services/salvage.service.js';

/** Maximum allowed chunk range per axis to prevent oversized queries */
const MAX_CHUNK_RANGE = 20;

/**
 * GET /api/world/chunks
 *
 * Returns visible asteroids within the requested chunk rectangle.
 * Visibility is filtered by the authenticated player's scanner building:
 *   asteroid.hidden_level <= scannerStrength
 *
 * Query params:
 *   minChunkX, maxChunkX  — chunk X range (inclusive)
 *   minChunkY, maxChunkY  — chunk Y range (inclusive)
 */
export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const range = parseChunkRange(request.query, MAX_CHUNK_RANGE);
    const { minChunkX, maxChunkX, minChunkY, maxChunkY } = range;

    const scannerStrength = await getUserScannerStrength(request.user.userId);
    const [asteroids, stations, debris] = await Promise.all([
      getVisibleChunkAsteroids({
        minChunkX,
        maxChunkX,
        minChunkY,
        maxChunkY,
        scannerStrength,
      }),
      getVisibleChunkStations(range, request.user.userId),
      getVisibleDebris(range),
    ]);

    return { asteroids, stations, debris };
  });
}) satisfies FastifyPluginAsync;
