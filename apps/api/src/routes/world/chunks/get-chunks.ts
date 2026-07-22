import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getVisibleChunkAsteroids } from '../../../services/asteroid.service.js';
import { getVisibleChunkStations, parseChunkRange } from '../../../services/world.service.js';
import { getVisibleDebris } from '../../../services/salvage.service.js';
import { getUserScannerCoverages } from '../../../services/scanner-visibility.service.js';
import type { VisibilityProjectionStats } from '../../../services/scanner-visibility.service.js';

/** Maximum allowed chunk range per axis to prevent oversized queries */
const MAX_CHUNK_RANGE = 20;

/**
 * GET /api/world/chunks
 *
 * Returns visible asteroids within the requested chunk rectangle.
 * Visibility is filtered by the authenticated player's station scanner circles.
 *
 * Query params:
 *   minChunkX, maxChunkX  — chunk X range (inclusive)
 *   minChunkY, maxChunkY  — chunk Y range (inclusive)
 */
export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const range = parseChunkRange(request.query, MAX_CHUNK_RANGE);
    const { minChunkX, maxChunkX, minChunkY, maxChunkY } = range;
    const query = request.query as Record<string, string | undefined>;
    const scannerBypass = request.user.role === 'admin' && query['scannerBypass'] === 'true';

    const coverages = scannerBypass ? [] : await getUserScannerCoverages(request.user.userId);
    const stats: VisibilityProjectionStats = {};
    const [asteroids, stations, debris] = await Promise.all([
      getVisibleChunkAsteroids(
        { minChunkX, maxChunkX, minChunkY, maxChunkY },
        coverages,
        stats,
        scannerBypass
      ),
      getVisibleChunkStations(range, request.user.userId, coverages, stats, scannerBypass),
      getVisibleDebris(range, coverages, stats, scannerBypass),
    ]);
    request.log.debug(
      {
        scannerBypass,
        scannerCoverages: coverages.length,
        ...stats,
        visibleAsteroids: asteroids.length,
        visibleStations: stations.length,
        visibleDebris: debris.length,
      },
      'Projected scanner-visible world chunks'
    );

    return { asteroids, stations, debris };
  });
}) satisfies FastifyPluginAsync;
