import { and, asc, eq } from 'drizzle-orm';
import type { GameExecutionContext } from '../game-execution-context.js';
import { getDb } from '../db/index.js';
import { botControllers, type BotProfile } from '../db/schema/bot-controllers.js';
import { sectors } from '../db/schema/sectors.js';
import { stations } from '../db/schema/stations.js';
import { users } from '../db/schema/users.js';
import { createStation } from '../../services/station.service.js';
import { seedBotsForSector } from '../../services/bot/bot-provision.service.js';
import { GOAL_BOT_STRATEGY, GOAL_BOT_STRATEGY_VERSION } from '../../services/bot/bot-profiles.js';
import { selectWeightedProfile, type BotProfileWeights } from './profile-distribution.js';

export type PopulationKind = 'resident_bot' | 'synthetic_player';

export interface PlaytestPopulationMember {
  alias: string;
  userId: string;
  initialStationId: string;
  profile: BotProfile;
  joinedAt: Date;
  populationKind: PopulationKind;
}

export interface JoinSyntheticPlayerOptions {
  playerIndex: number;
  profileWeights: BotProfileWeights;
  registry: PlaytestPopulationRegistry;
}

export interface SyntheticPlayerJoinResult {
  member: PlaytestPopulationMember;
  sectorId: string;
  registeredResidents: PlaytestPopulationMember[];
}

function copyMember(member: PlaytestPopulationMember): PlaytestPopulationMember {
  return { ...member, joinedAt: new Date(member.joinedAt) };
}

export class PlaytestPopulationRegistry {
  private readonly byAlias = new Map<string, PlaytestPopulationMember>();
  private readonly aliasByUserId = new Map<string, string>();

  register(member: PlaytestPopulationMember): void {
    const existingByAlias = this.byAlias.get(member.alias);
    const existingAlias = this.aliasByUserId.get(member.userId);
    if (existingByAlias || existingAlias) {
      if (
        existingByAlias?.userId === member.userId &&
        existingAlias === member.alias &&
        existingByAlias.initialStationId === member.initialStationId &&
        existingByAlias.profile === member.profile &&
        existingByAlias.joinedAt.getTime() === member.joinedAt.getTime() &&
        existingByAlias.populationKind === member.populationKind
      ) {
        return;
      }
      throw new Error(`Population registry collision for ${member.alias}/${member.userId}`);
    }
    this.byAlias.set(member.alias, copyMember(member));
    this.aliasByUserId.set(member.userId, member.alias);
  }

  getByAlias(alias: string): PlaytestPopulationMember | undefined {
    const member = this.byAlias.get(alias);
    return member ? copyMember(member) : undefined;
  }

  getByUserId(userId: string): PlaytestPopulationMember | undefined {
    const alias = this.aliasByUserId.get(userId);
    return alias ? this.getByAlias(alias) : undefined;
  }

  snapshot(): PlaytestPopulationMember[] {
    return [...this.byAlias.values()]
      .sort((left, right) => left.alias.localeCompare(right.alias))
      .map(copyMember);
  }
}

function paddedIndex(index: number): string {
  return String(index + 1).padStart(3, '0');
}

function coordinateKey(value: number): string {
  return value < 0 ? `m${-value}` : `p${value}`;
}

async function registerResidents(
  sectorId: string,
  registry: PlaytestPopulationRegistry
): Promise<PlaytestPopulationMember[]> {
  const db = getDb();
  const residents = await db
    .select({
      userId: users.id,
      username: users.username,
      createdAt: users.createdAt,
      stationId: stations.id,
      profile: botControllers.profile,
      sectorX: sectors.sectorX,
      sectorY: sectors.sectorY,
    })
    .from(users)
    .innerJoin(stations, eq(stations.userId, users.id))
    .innerJoin(sectors, eq(stations.sectorId, sectors.id))
    .innerJoin(botControllers, eq(botControllers.userId, users.id))
    .where(and(eq(users.role, 'bot'), eq(stations.sectorId, sectorId)))
    .orderBy(asc(users.username));

  return residents.map((resident, index) => {
    const member: PlaytestPopulationMember = {
      alias: `resident-${coordinateKey(resident.sectorX)}-${coordinateKey(
        resident.sectorY
      )}-${paddedIndex(index)}`,
      userId: resident.userId,
      initialStationId: resident.stationId,
      profile: resident.profile as BotProfile,
      joinedAt: resident.createdAt,
      populationKind: 'resident_bot',
    };
    registry.register(member);
    return member;
  });
}

export async function joinSyntheticPlayer(
  options: JoinSyntheticPlayerOptions,
  context: GameExecutionContext
): Promise<SyntheticPlayerJoinResult> {
  if (!Number.isInteger(options.playerIndex) || options.playerIndex < 0) {
    throw new Error('Synthetic player index must be a non-negative integer');
  }

  const alias = `player-${paddedIndex(options.playerIndex)}`;
  if (options.registry.getByAlias(alias)) {
    throw new Error(`Synthetic player ${alias} already joined this run`);
  }

  const db = getDb();
  const username = `playtest-${alias}`;
  const email = `${username}@playtest.invalid`;
  const profile = selectWeightedProfile(
    context.worldSeed,
    options.playerIndex,
    options.profileWeights
  );
  const [user] = await db
    .insert(users)
    .values({
      id: context.nextId('synthetic-player-user'),
      username,
      email,
      passwordHash: `disabled:${context.nextId('synthetic-player-password')}`,
      role: 'player',
      status: 'active',
      createdAt: context.now,
      updatedAt: context.now,
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`Failed to create synthetic player ${alias}`);

  const station = await createStation(
    user.id,
    { name: `Synthetic Station ${paddedIndex(options.playerIndex)}` },
    context
  );
  await seedBotsForSector(station.sectorId, context);
  await db.insert(botControllers).values({
    userId: user.id,
    strategy: GOAL_BOT_STRATEGY,
    strategyVersion: GOAL_BOT_STRATEGY_VERSION,
    profile,
    nextDecisionAt: context.now,
    updatedAt: context.now,
  });

  const member: PlaytestPopulationMember = {
    alias,
    userId: user.id,
    initialStationId: station.id,
    profile,
    joinedAt: context.now,
    populationKind: 'synthetic_player',
  };
  options.registry.register(member);
  const registeredResidents = await registerResidents(station.sectorId, options.registry);
  return { member, sectorId: station.sectorId, registeredResidents };
}
