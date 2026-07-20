import type { FastifyPluginAsync } from 'fastify';
import { RegisterRequestSchema } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { registerUser } from '../../services/auth.service.js';

/**
 * POST /api/auth/register
 */
export default (async (app) => {
  app.post('/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request body', {
        issues: parsed.error.issues,
      });
    }

    const { username, email, password } = parsed.data;
    const user = await registerUser(username, email, password);
    const token = app.jwt.sign({ userId: user.id, role: user.role });

    return reply.status(201).send({ success: true, data: { token, user } });
  });
}) satisfies FastifyPluginAsync;
