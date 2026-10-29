import { LoginRequestSchema } from '@orions-frontier/shared';
import { loginUser } from '../../services/auth/index.js';
import { AUTH_RATE_LIMIT, defineRoute } from '../../lib/route.js';

/**
 * POST /api/auth/login
 */
export default defineRoute(async (app) => {
  app.post(
    '/login',
    { schema: { body: LoginRequestSchema }, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request) => {
      const { email, password } = request.body;
      const user = await loginUser(email, password);
      const token = app.jwt.sign({ userId: user.id, role: user.role });

      return { token, user };
    }
  );
});
