import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ErrorCode, type JwtPayload } from '@orions-frontier/shared';
import { findUserById } from '../services/auth/index.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/**
 * Fastify preHandler — validates JWT and sets request.user.
 * Use as `preHandler: [authenticate]` on protected routes.
 * A valid token is not enough: the account must still be active, and its current role counts.
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
  const user = await findUserById(request.user.userId);
  if (user?.status !== 'active') {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required');
  }
  request.user.role = user.role;
};
