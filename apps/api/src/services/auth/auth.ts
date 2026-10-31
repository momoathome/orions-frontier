import bcrypt from 'bcrypt';
import { getDb } from '../../lib/db/index.js';
import {
  findUser,
  findUserByEmail,
  hasUserWithEmail,
  hasUserWithUsername,
  insertUser,
  type UserRow,
} from './repositories/users.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import type { AuthenticatedUser } from '@orions-frontier/shared';

const BCRYPT_ROUNDS = 12;
/** Compared against for unknown emails, so a login takes as long whether the account exists or not. */
const DUMMY_HASH = '$2b$12$Nla5fysvrRgC5HoYYVLMpOxqXftKaKZfTzP/L4WVQRVHBf547vH9W';

export const toAuthenticatedUser = (user: UserRow): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const findUserById = async (id: string) => {
  const user = await findUser(getDb(), id);
  return user ?? null;
};

// Login: validate credentials, return authenticated user
// JWT signing stays in the route (HTTP concern)

export const loginUser = async (email: string, password: string): Promise<AuthenticatedUser> => {
  const user = await findUserByEmail(getDb(), email);
  const passwordValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordValid) {
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
    hasUserWithEmail(getDb(), email),
    hasUserWithUsername(getDb(), username),
  ]);

  if (existingEmail) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Email already in use');
  }
  if (existingUsername) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await insertUser(getDb(), { username, email, passwordHash });
  return toAuthenticatedUser(user);
};
