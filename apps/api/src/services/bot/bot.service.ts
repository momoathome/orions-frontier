import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { startBuildingUpgrade } from '../building.service.js';
import { createAsteroidAssignment } from '../mining/assignment.service.js';
import { buildSpacecrafts } from '../spacecraft.service.js';
import { loadEconomicBotState } from './bot-state.service.js';
import { decideEconomicAction } from './economic-v1.js';
import type { BotIntent } from './economic-v1.js';

const logger = rootLogger.child({ name: 'bots' });
const DECISION_INTERVAL_MS = 60_000;

async function executeIntent(userId: string, intent: BotIntent): Promise<void> {
  switch (intent.type) {
    case 'wait':
      return;
    case 'assign_miner': {
      const result = await createAsteroidAssignment({
        userId,
        asteroidId: intent.asteroidId,
        stationId: intent.stationId,
        spacecraftKey: intent.spacecraftKey,
        assignedAmount: intent.amount,
      });
      if ('code' in result) throw new Error(`${result.code}: ${result.message}`);
      return;
    }
    case 'build_spacecraft':
      await buildSpacecrafts(intent.stationId, userId, [
        { spacecraftKey: intent.spacecraftKey, amount: intent.amount },
      ]);
      return;
    case 'upgrade_building':
      await startBuildingUpgrade(intent.stationId, intent.buildingKey, userId);
  }
}

export async function runBotDecisionTick(now = new Date()): Promise<void> {
  const db = getDb();
  const due = await db
    .select({ userId: botControllers.userId })
    .from(botControllers)
    .where(lte(botControllers.nextDecisionAt, now))
    .orderBy(asc(botControllers.nextDecisionAt), asc(botControllers.userId));

  for (const bot of due) {
    const nextDecisionAt = new Date(now.getTime() + DECISION_INTERVAL_MS);
    const [claimed] = await db
      .update(botControllers)
      .set({ nextDecisionAt, updatedAt: now })
      .where(and(eq(botControllers.userId, bot.userId), lte(botControllers.nextDecisionAt, now)))
      .returning({ strategy: botControllers.strategy });
    if (!claimed) continue;

    let action = 'wait';
    let reason = 'Bot has no station';
    try {
      const state = await loadEconomicBotState(bot.userId);
      if (state && claimed.strategy === 'economic_v1') {
        const intent = decideEconomicAction(state);
        action = intent.type;
        reason = intent.reason;
        await executeIntent(bot.userId, intent);
      } else if (state) {
        reason = `Unknown bot strategy: ${claimed.strategy}`;
      }
    } catch (error) {
      action = `${action}_failed`;
      reason = error instanceof Error ? error.message : 'Unknown bot error';
      logger.warn({ botUserId: bot.userId, error }, 'Bot action failed');
    }

    await db
      .update(botControllers)
      .set({ lastAction: action, lastReason: reason.slice(0, 255), updatedAt: now })
      .where(eq(botControllers.userId, bot.userId));
  }
}
