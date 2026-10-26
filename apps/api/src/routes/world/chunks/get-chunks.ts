import { authenticate } from '../../../middleware/auth.js';
import { getVisibleChunkAsteroids } from '../../../services/asteroid.service.js';
import { getVisibleChunkStations, parseChunkRange } from '../../../services/world.service.js';
import { getVisibleDebris } from '../../../services/salvage.service.js';
import {
  getUserRevealedAsteroidIds,
  getUserScannerCoverages,
} from '../../../services/scanner-visibility.service.js';
import type { VisibilityProjectionStats } from '../../../services/scanner-visibility.service.js';
import { defineRoute, chunkRangeQuery } from '../../../lib/route.js';

/** Maximum allowed chunk range per axis to prevent oversized queries */
const MAX_CHUNK_RANGE = 20;

/**
 * GET /api/world/chunks
 *
 * Returns asteroids, stations and debris within the requested chunk rectangle.
 * Asteroids and stations are always listed; scanner circles decide their detail level.
 * Debris stays limited to scanner coverage.
 *
 * Query params:
 *   minChunkX, maxChunkX  — chunk X range (inclusive)
 *   minChunkY, maxChunkY  — chunk Y range (inclusive)
 */
export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { querystring: chunkRangeQuery } },
    async (request) => {
      const range = parseChunkRange(request.query, MAX_CHUNK_RANGE);
      const { minChunkX, maxChunkX, minChunkY, maxChunkY } = range;
      const scannerBypass = request.user.role === 'admin' && request.query.scannerBypass === 'true';

      const [coverages, revealedIds] = scannerBypass
        ? [[], new Set<string>()]
        : await Promise.all([
            getUserScannerCoverages(request.user.userId),
            getUserRevealedAsteroidIds(request.user.userId),
          ]);
      const stats: VisibilityProjectionStats = {};
      const [asteroids, stations, debris] = await Promise.all([
        getVisibleChunkAsteroids(
          { minChunkX, maxChunkX, minChunkY, maxChunkY },
          coverages,
          stats,
          scannerBypass,
          revealedIds
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
    }
  );
});
