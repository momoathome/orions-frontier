import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getVisibleChunkAsteroids } from '../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/** Maximum allowed chunk range per axis to prevent oversized queries */
const MAX_CHUNK_RANGE = 20;

/**
 * GET /api/world/chunks
 *
 * Returns visible asteroids within the requested chunk rectangle.
 * Visibility is filtered by the caller-supplied scannerStrength:
 *   asteroid.hidden_level <= scannerStrength
 *
 * Query params:
 *   minChunkX, maxChunkX  — chunk X range (inclusive)
 *   minChunkY, maxChunkY  — chunk Y range (inclusive)
 *   scannerStrength       — optional, defaults to 0
 */
export default defineRoute(async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;

    const minChunkX = parseInt(q['minChunkX'] ?? '', 10);
    const maxChunkX = parseInt(q['maxChunkX'] ?? '', 10);
    const minChunkY = parseInt(q['minChunkY'] ?? '', 10);
    const maxChunkY = parseInt(q['maxChunkY'] ?? '', 10);
    const scannerStrength = Math.max(0, parseInt(q['scannerStrength'] ?? '0', 10) || 0);

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

    const data = await getVisibleChunkAsteroids({
      minChunkX,
      maxChunkX,
      minChunkY,
      maxChunkY,
      scannerStrength,
    });

    return reply.send({ success: true, data });
  });
});
