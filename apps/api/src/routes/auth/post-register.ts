import { RegisterRequestSchema } from '@orions-frontier/shared';
import { registerUser } from '../../services/auth/index.js';
import { AUTH_RATE_LIMIT, defineRoute } from '../../lib/route.js';

/**
 * POST /api/auth/register
 */
export default defineRoute(async (app) => {
  app.post(
    '/register',
    { schema: { body: RegisterRequestSchema }, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { username, email, password } = request.body;
      const user = await registerUser(username, email, password);
      const token = app.jwt.sign({ userId: user.id, role: user.role });

      return reply.status(201).send({ token, user });
    }
  );
});
