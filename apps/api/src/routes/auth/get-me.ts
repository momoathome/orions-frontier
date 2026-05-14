import { eq } from 'drizzle-orm';
import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { getDb } from '../../lib/db/index.js';
import { users } from '../../lib/db/schema/users.js';
import { toAuthenticatedUser } from '../../services/user.service.js';

/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.user.userId))
      .limit(1);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }

    return reply.send({
      success: true,
      data: toAuthenticatedUser(user),
    });
  });
});
