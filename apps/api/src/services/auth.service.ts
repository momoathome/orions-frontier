import bcrypt from 'bcrypt';
import { findUserByEmail, findUserByUsername, createUser } from './user.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import type { AuthenticatedUser } from '@orions-frontier/shared';

const BCRYPT_ROUNDS = 12;

// ============================================================================
// Login: validate credentials, return authenticated user
// JWT signing stays in the route (HTTP concern)
// ============================================================================

export const loginUser = async (email: string, password: string): Promise<AuthenticatedUser> => {
  const user = await findUserByEmail(email);
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

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role as 'admin' | 'player',
    status: user.status as 'active' | 'inactive' | 'banned',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ============================================================================
// Register: uniqueness checks, hash password, create user
// JWT signing stays in the route (HTTP concern)
// ============================================================================

export const registerUser = async (
  username: string,
  email: string,
  password: string
): Promise<AuthenticatedUser> => {
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
  return createUser({ username, email, passwordHash });
};
