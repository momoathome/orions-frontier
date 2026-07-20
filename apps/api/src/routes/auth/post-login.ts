import type { FastifyPluginAsync } from 'fastify';
import { LoginRequestSchema } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { loginUser } from '../../services/auth.service.js';

/**
 * POST /api/auth/login
 */
export default (async (app) => {
  app.post('/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request body', {
        issues: parsed.error.issues,
      });
    }

    const { email, password } = parsed.data;
    const user = await loginUser(email, password);
    const token = app.jwt.sign({ userId: user.id, role: user.role });

    return reply.send({ success: true, data: { token, user } });
  });
}) satisfies FastifyPluginAsync;
