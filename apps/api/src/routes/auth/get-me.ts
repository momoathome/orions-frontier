import { authenticate } from '../../middleware/auth.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { findUserById, toAuthenticatedUser } from '../../services/auth/index.js';
import { defineRoute } from '../../lib/route.js';

/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/me', { onRequest: [authenticate] }, async (request) => {
    const user = await findUserById(request.user.userId);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }

    return toAuthenticatedUser(user);
  });
});
