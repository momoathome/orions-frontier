import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../middleware/auth.js';
import { getVisibleWorldTrips } from '../../../services/world.service.js';

// At the minimum map zoom a desktop viewport spans considerably more than the
// 20 chunks used by static chunk batches. Active trips are already fetched as
// one small world projection, so a wider viewport does not multiply DB work.
const MAX_CHUNK_RANGE = 100;

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const number = (value: string | undefined) =>
      value === undefined || value.trim() === '' ? Number.NaN : Number(value);
    const range = {
      minChunkX: number(query['minChunkX']),
      maxChunkX: number(query['maxChunkX']),
      minChunkY: number(query['minChunkY']),
      maxChunkY: number(query['maxChunkY']),
    };
    const values = Object.values(range);
    if (!values.every(Number.isInteger)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chunk range requires integer values');
    }
    if (
      range.minChunkX > range.maxChunkX ||
      range.minChunkY > range.maxChunkY ||
      range.maxChunkX - range.minChunkX > MAX_CHUNK_RANGE ||
      range.maxChunkY - range.minChunkY > MAX_CHUNK_RANGE
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid or oversized chunk range');
    }

    return reply.send({
      success: true,
      data: await getVisibleWorldTrips(range, request.user.userId),
    });
  });
}) satisfies FastifyPluginAsync;
