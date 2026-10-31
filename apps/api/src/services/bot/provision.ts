import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { getDb } from '../../lib/db/index.js';
import { insertBotControllerIfAbsent } from './repositories/bot-controllers.js';
import { findSettlementSector, listBotSettlementSectorIds } from '../map/index.js';
import { findUserByEmail, insertUser } from '../auth/index.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import {
  createStation,
  hasHumanStationInSector,
  listBotUserIdsInSector,
} from '../station/index.js';
import { GOAL_BOT_STRATEGY, GOAL_BOT_STRATEGY_VERSION, profileForKey } from './profiles.js';

const coordinateKey = (value: number) => (value < 0 ? `m${-value}` : `p${value}`);

export async function seedBotsForOccupiedSectors(
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const db = getDb();
  // Sectors without generated bot slots (hand-made fixtures) cannot host bots.
  const settlementSectors = await listBotSettlementSectorIds(db);

  for (const sector of settlementSectors) {
    await seedBotsForSector(sector.id, context);
  }
}

export async function seedBotsForSector(
  sectorId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const db = getDb();
  const sector = await findSettlementSector(db, sectorId);
  if (!sector) return;

  if (!(await hasHumanStationInSector(db, sector.id))) return;

  const existingBots = await listBotUserIdsInSector(db, sector.id);
  for (const bot of existingBots) {
    await insertBotControllerIfAbsent(db, {
      userId: bot.userId,
      strategy: GOAL_BOT_STRATEGY,
      strategyVersion: GOAL_BOT_STRATEGY_VERSION,
      profile: profileForKey(bot.userId),
      nextDecisionAt: context.now,
      updatedAt: context.now,
    });
  }

  for (let index = 1; index <= WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT; index += 1) {
    const key = `${coordinateKey(sector.sectorX)}-${coordinateKey(sector.sectorY)}-${index}`;
    const username = `orion-bot-${key}`;
    const email = `${username}@system.invalid`;
    const createdUser = await insertUser(db, {
      id: context.nextId('user'),
      username,
      email,
      passwordHash: `disabled:${context.nextId('disabled-password')}`,
      role: 'bot',
      createdAt: context.now,
      updatedAt: context.now,
    });
    const user = createdUser ?? (await findUserByEmail(db, email));
    // A player who registered this name or email is not a bot and gets no bot station.
    if (user?.role !== 'bot') continue;
    // A destroyed bot station stays destroyed; only a bot that never had one here gets one.
    if (existingBots.some((bot) => bot.userId === user.id)) continue;

    await insertBotControllerIfAbsent(db, {
      userId: user.id,
      strategy: GOAL_BOT_STRATEGY,
      strategyVersion: GOAL_BOT_STRATEGY_VERSION,
      profile: profileForKey(key),
      nextDecisionAt: context.now,
      updatedAt: context.now,
    });

    await createStation(
      user.id,
      {
        name: `Prospector ${index}`,
        slotType: 'bot',
        sectorId: sector.id,
      },
      context
    );
  }
}
