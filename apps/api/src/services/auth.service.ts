import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { users } from '../lib/db/schema/users.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import type { AuthenticatedUser } from '@orions-frontier/shared';

const BCRYPT_ROUNDS = 12;

export const toAuthenticatedUser = (user: typeof users.$inferSelect): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role as AuthenticatedUser['role'],
  status: user.status as AuthenticatedUser['status'],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const findUserById = async (id: string) => {
  const [user] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
};

// Login: validate credentials, return authenticated user
// JWT signing stays in the route (HTTP concern)

export const loginUser = async (email: string, password: string): Promise<AuthenticatedUser> => {
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new AppError(ErrorCode.FORBIDDEN, 'Account is not active');
  }

  return toAuthenticatedUser(user);
};

// Register: uniqueness checks, hash password, create user
// JWT signing stays in the route (HTTP concern)

export const registerUser = async (
  username: string,
  email: string,
  password: string
): Promise<AuthenticatedUser> => {
  const [existingEmail, existingUsername] = await Promise.all([
    getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
    getDb().select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1),
  ]);

  if (existingEmail.length > 0) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Email already in use');
  }
  if (existingUsername.length > 0) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const [user] = await getDb().insert(users).values({ username, email, passwordHash }).returning();
  return toAuthenticatedUser(user!);
};
