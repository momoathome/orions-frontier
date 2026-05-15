import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stations } from '../lib/db/schema/stations.js';
import type { Station } from '@orions-frontier/shared';

// ============================================================================
// Fastify Request Extension
// ============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    station: Station;
  }
}

// ============================================================================
// UUID validation regex
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================================
// Middleware
// ============================================================================

/**
 * Fastify preHandler — reads x-station-id header, validates UUID format,
 * checks ownership and injects the station into request.station.
 *
 * Requires the `authenticate` preHandler to run first so request.user is set.
 */
export const requireStation = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const stationId = request.headers['x-station-id'];

  if (!stationId || typeof stationId !== 'string' || !UUID_REGEX.test(stationId)) {
    return reply.status(400).send({ message: 'Missing station context' });
  }

  const db = getDb();

  const [station] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
    .limit(1);

  if (!station) {
    return reply.status(403).send({ message: 'Invalid station access' });
  }

  request.station = {
    id: station.id,
    userId: station.userId,
    name: station.name,
    x: station.x,
    y: station.y,
    createdAt: station.createdAt.toISOString(),
  };
};
