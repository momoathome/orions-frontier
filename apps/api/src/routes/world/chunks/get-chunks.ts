import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import {
  getUserScannerStrength,
  getVisibleChunkAsteroids,
} from '../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { getVisibleChunkStations } from '../../../services/world.service.js';

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
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;

    const minChunkX = parseInt(q['minChunkX'] ?? '', 10);
    const maxChunkX = parseInt(q['maxChunkX'] ?? '', 10);
    const minChunkY = parseInt(q['minChunkY'] ?? '', 10);
    const maxChunkY = parseInt(q['maxChunkY'] ?? '', 10);

    if (isNaN(minChunkX) || isNaN(maxChunkX) || isNaN(minChunkY) || isNaN(maxChunkY)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'minChunkX, maxChunkX, minChunkY, maxChunkY are required integer query parameters'
      );
    }

    if (minChunkX > maxChunkX || minChunkY > maxChunkY) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'min chunk values must not exceed max values');
    }

    if (maxChunkX - minChunkX > MAX_CHUNK_RANGE || maxChunkY - minChunkY > MAX_CHUNK_RANGE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Chunk range per axis must not exceed ${MAX_CHUNK_RANGE}`
      );
    }

    const scannerStrength = await getUserScannerStrength(request.user.userId);
    const [asteroids, stations] = await Promise.all([
      getVisibleChunkAsteroids({
        minChunkX,
        maxChunkX,
        minChunkY,
        maxChunkY,
        scannerStrength,
      }),
      getVisibleChunkStations({ minChunkX, maxChunkX, minChunkY, maxChunkY }, request.user.userId),
    ]);

    return reply.send({ success: true, data: { asteroids, stations } });
  });
}) satisfies FastifyPluginAsync;
