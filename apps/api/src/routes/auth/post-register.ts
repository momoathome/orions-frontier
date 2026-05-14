import bcrypt from 'bcrypt';
import { defineRoute } from '../../lib/route-helper.js';
import { RegisterRequestSchema } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { findUserByEmail, findUserByUsername, createUser } from '../../services/user.service.js';

const BCRYPT_ROUNDS = 12;

/**
 * POST /api/auth/register
 */
export default defineRoute(async (app) => {
  app.post('/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request body', {
        issues: parsed.error.issues,
      });
    }

    const { username, email, password } = parsed.data;

    const [existingEmail, existingUsername] = await Promise.all([
      findUserByEmail(email),
      findUserByUsername(username),
    ]);

    if (existingEmail) {
      throw new AppError(ErrorCode.ALREADY_EXISTS, 'Email already in use');
    }
    if (existingUsername) {
      throw new AppError(ErrorCode.ALREADY_EXISTS, 'Username already taken');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await createUser({ username, email, passwordHash });

    const token = app.jwt.sign({ userId: user.id, role: user.role });

    return reply.status(201).send({
      success: true,
      data: { token, user },
    });
  });
});
