import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * Fastify preHandler — validates JWT and sets request.user.
 * Use as `preHandler: [authenticate]` on protected routes.
 */
export const authenticate = async (
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required');
  }
};
