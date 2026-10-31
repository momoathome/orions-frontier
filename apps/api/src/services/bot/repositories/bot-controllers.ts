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

/** Like `updateBotController`, but returns the goal the controller holds afterwards. */
export async function updateBotControllerReturningGoal(
  db: QueryDb,
  userId: string,
  values: BotControllerUpdate
) {
  const [row] = await db
    .update(botControllers)
    .set(values)
    .where(eq(botControllers.userId, userId))
    .returning({
      activeGoalType: botControllers.activeGoalType,
      activeGoalTarget: botControllers.activeGoalTarget,
    });
  return row;
}

export function listDueBotControllerUserIds(db: QueryDb, now: Date) {
  return db
    .select({ userId: botControllers.userId })
    .from(botControllers)
    .where(lte(botControllers.nextDecisionAt, now))
    .orderBy(asc(botControllers.nextDecisionAt), asc(botControllers.userId));
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
