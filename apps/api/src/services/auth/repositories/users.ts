import { eq } from 'drizzle-orm';
import { required } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { users } from '../../../lib/db/schema/users.js';

export type UserRow = typeof users.$inferSelect;

export async function findUser(db: QueryDb, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function findUserForUpdate(tx: Tx, id: string) {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).for('update');
  return row;
}

export async function findUserByEmail(db: QueryDb, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function hasUserWithEmail(db: QueryDb, email: string) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return rows.length > 0;
}

export async function hasUserWithUsername(db: QueryDb, username: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows.length > 0;
}

export async function insertUser(db: QueryDb, values: typeof users.$inferInsert) {
  const [row] = await db.insert(users).values(values).returning();
  return required(row, 'user');
}

export async function updateUser(tx: Tx, id: string, values: Partial<typeof users.$inferInsert>) {
  await tx.update(users).set(values).where(eq(users.id, id));
}

/** Returns the new user's id, or undefined if the username or email is already taken. */
export async function insertUserIfAbsent(db: QueryDb, values: typeof users.$inferInsert) {
  const [row] = await db
    .insert(users)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: users.id });
  return row;
}
