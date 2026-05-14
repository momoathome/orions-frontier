import bcrypt from 'bcrypt';
import { defineRoute } from '../../lib/route-helper.js';
import { LoginRequestSchema } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { findUserByEmail, toAuthenticatedUser } from '../../services/user.service.js';

/**
 * POST /api/auth/login
 */
export default defineRoute(async (app) => {
  app.post('/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request body', {
        issues: parsed.error.issues,
      });
    }

    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    if (!user) {
      // Generic message to prevent user enumeration
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account is not active');
    }

    const token = app.jwt.sign({ userId: user.id, role: user.role as 'admin' | 'player' });

    return reply.send({
      success: true,
      data: { token, user: toAuthenticatedUser(user) },
    });
  });
});
