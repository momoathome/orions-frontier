import { and, asc, eq, lte } from 'drizzle-orm';
import type { QueryDb } from '../../../lib/db/index.js';
import { botControllers } from '../../../lib/db/schema/bot-controllers.js';

export { goalTypes } from '../../../lib/db/schema/bot-controllers.js';

export type BotControllerRow = typeof botControllers.$inferSelect;
export type BotControllerUpdate = Partial<typeof botControllers.$inferInsert>;

/** Keeps an existing controller untouched. */
export async function insertBotControllerIfAbsent(
  db: QueryDb,
  values: typeof botControllers.$inferInsert
) {
  await db
    .insert(botControllers)
    .values(values)
    .onConflictDoNothing({ target: botControllers.userId });
}

export async function updateBotController(
  db: QueryDb,
  userId: string,
  values: BotControllerUpdate
) {
  await db.update(botControllers).set(values).where(eq(botControllers.userId, userId));
}

/** Due bots, longest-waiting first; without a limit, all of them. */
export function listDueBotControllerUserIds(db: QueryDb, now: Date, limit?: number) {
  const query = db
    .select({ userId: botControllers.userId })
    .from(botControllers)
    .where(lte(botControllers.nextDecisionAt, now))
    .orderBy(asc(botControllers.nextDecisionAt), asc(botControllers.userId));
  return limit === undefined ? query : query.limit(limit);
}

/** Moves a due decision to `nextDecisionAt`; undefined if another tick claimed it first. */
export async function claimBotDecision(
  db: QueryDb,
  userId: string,
  now: Date,
  nextDecisionAt: Date
) {
  const [claimed] = await db
    .update(botControllers)
    .set({ nextDecisionAt, updatedAt: now })
    .where(and(eq(botControllers.userId, userId), lte(botControllers.nextDecisionAt, now)))
    .returning();
  return claimed;
}
