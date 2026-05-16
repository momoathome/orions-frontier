import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { users } from '../lib/db/schema/users.js';
import type { AuthenticatedUser } from '@orions-frontier/shared';

export const findUserById = async (id: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
};

export const findUserByEmail = async (email: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
};

export const findUserByUsername = async (username: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return user ?? null;
};

export const createUser = async (data: {
  username: string;
  email: string;
  passwordHash: string;
}): Promise<AuthenticatedUser> => {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
    })
    .returning();

  return {
    id: user!.id,
    username: user!.username,
    email: user!.email,
    role: user!.role as 'admin' | 'player',
    status: user!.status as 'active' | 'inactive' | 'banned',
    createdAt: user!.createdAt,
    updatedAt: user!.updatedAt,
  };
};

export const toAuthenticatedUser = (user: {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role as 'admin' | 'player',
  status: user.status as 'active' | 'inactive' | 'banned',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
