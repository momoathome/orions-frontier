import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { findUserById, toAuthenticatedUser } from '../../services/user.service.js';

/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
export default (async (app) => {
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await findUserById(request.user.userId);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }

    return reply.send({
      success: true,
      data: toAuthenticatedUser(user),
    });
  });
}) satisfies FastifyPluginAsync;
