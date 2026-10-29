import { and, asc, eq } from 'drizzle-orm';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { sectors } from '../../lib/db/schema/sectors.js';
import { spawnSlots } from '../../lib/db/schema/spawn-slots.js';
import { stations } from '../../lib/db/schema/stations.js';
import { users } from '../../lib/db/schema/users.js';
import { GOAL_BOT_STRATEGY, GOAL_BOT_STRATEGY_VERSION } from '../../services/bot/index.js';
import { joinSyntheticPlayer, PlaytestPopulationRegistry } from './population.js';
import { EVEN_PROFILE_WEIGHTS } from './profile-distribution.js';

const SMOKE_PLAYER_COUNT = 7;
const JOIN_INTERVAL_MS = 60 * 60 * 1_000;

export interface PlaytestPopulationSmokeResult {
  syntheticPlayers: number;
  residentBots: number;
  settlementSectors: number;
  controllers: number;
  occupiedPlayerSlots: number;
  occupiedBotSlots: number;
  registryMembers: number;
  aliases: string[];
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Playtest population smoke failed: ${message}`);
}

export async function runPlaytestPopulationSmoke(
  context: GameExecutionContext
): Promise<PlaytestPopulationSmokeResult> {
  const registry = new PlaytestPopulationRegistry();
  const expectedJoinTimes = new Map<string, number>();

  for (let playerIndex = 0; playerIndex < SMOKE_PLAYER_COUNT; playerIndex += 1) {
    const joinAt = new Date(context.now.getTime() + playerIndex * JOIN_INTERVAL_MS);
    const result = await joinSyntheticPlayer(
      { playerIndex, profileWeights: EVEN_PROFILE_WEIGHTS, registry },
      context.at(joinAt)
    );
    expectedJoinTimes.set(result.member.userId, joinAt.getTime());
  }

  const db = getDb();
  const [accountRows, controllerRows, settlementRows, occupiedSlots] = await Promise.all([
    db
      .select({
        id: users.id,
        role: users.role,
        createdAt: users.createdAt,
        stationId: stations.id,
      })
      .from(users)
      .innerJoin(stations, eq(stations.userId, users.id))
      .orderBy(asc(users.username)),
    db
      .select({
        userId: botControllers.userId,
        strategy: botControllers.strategy,
        strategyVersion: botControllers.strategyVersion,
        profile: botControllers.profile,
        nextDecisionAt: botControllers.nextDecisionAt,
        createdAt: users.createdAt,
      })
      .from(botControllers)
      .innerJoin(users, eq(users.id, botControllers.userId))
      .orderBy(asc(users.username)),
    db
      .select({ id: sectors.id })
      .from(sectors)
      .where(eq(sectors.role, 'settlement'))
      .orderBy(asc(sectors.sectorY), asc(sectors.sectorX)),
    db
      .select({ slotType: spawnSlots.slotType, userRole: users.role })
      .from(spawnSlots)
      .innerJoin(stations, eq(stations.id, spawnSlots.stationId))
      .innerJoin(users, eq(users.id, stations.userId))
      .innerJoin(sectors, eq(sectors.id, spawnSlots.sectorId))
      .where(and(eq(sectors.role, 'settlement'))),
  ]);

  const players = accountRows.filter((account) => account.role === 'player');
  const residents = accountRows.filter((account) => account.role === 'bot');
  const playerSlots = occupiedSlots.filter((slot) => slot.slotType === 'player');
  const botSlots = occupiedSlots.filter((slot) => slot.slotType === 'bot');

  requireCondition(players.length === SMOKE_PLAYER_COUNT, 'expected seven synthetic players');
  requireCondition(residents.length === 4, 'two settlements must each contain two resident bots');
  requireCondition(settlementRows.length === 2, 'seventh player must open a second settlement');
  requireCondition(
    playerSlots.length === SMOKE_PLAYER_COUNT &&
      playerSlots.every((slot) => slot.userRole === 'player'),
    'players must exclusively occupy normal player slots'
  );
  requireCondition(
    botSlots.length === residents.length && botSlots.every((slot) => slot.userRole === 'bot'),
    'residents must exclusively occupy bot slots'
  );
  requireCondition(
    controllerRows.length === players.length + residents.length,
    'every synthetic player and resident needs a controller'
  );
  requireCondition(
    controllerRows.every(
      (controller) =>
        controller.strategy === GOAL_BOT_STRATEGY &&
        controller.strategyVersion === GOAL_BOT_STRATEGY_VERSION
    ),
    'all controllers must use the current goal-driven strategy'
  );
  requireCondition(
    controllerRows.every(
      (controller) =>
        controller.nextDecisionAt.getTime() === controller.createdAt.getTime() &&
        ['industrialist', 'pioneer', 'technocrat', 'warlord'].includes(controller.profile)
    ),
    'controllers must start at join time with a valid profile'
  );
  requireCondition(
    players.every((player) => player.createdAt.getTime() === expectedJoinTimes.get(player.id)),
    'synthetic account timestamps must use virtual join time'
  );

  const members = registry.snapshot();
  requireCondition(
    members.length === players.length + residents.length,
    'population registry must contain the full controlled population'
  );
  requireCondition(
    members.filter((member) => member.populationKind === 'synthetic_player').length ===
      players.length,
    'registry must distinguish synthetic players'
  );
  requireCondition(
    members.filter((member) => member.populationKind === 'resident_bot').length ===
      residents.length,
    'registry must distinguish resident bots'
  );

  return {
    syntheticPlayers: players.length,
    residentBots: residents.length,
    settlementSectors: settlementRows.length,
    controllers: controllerRows.length,
    occupiedPlayerSlots: playerSlots.length,
    occupiedBotSlots: botSlots.length,
    registryMembers: members.length,
    aliases: members.map((member) => member.alias),
  };
}
