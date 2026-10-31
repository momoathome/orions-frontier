import {
  AppError,
  type KnownSector,
  ErrorCode,
  type FrontierResponse,
  type WorldMission,
} from '@orions-frontier/shared';
import {
  calculateColonizationCost,
  getSpacecraft,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import { getDb, type QueryDb, type Tx } from '../../lib/db/index.js';
import { listAsteroidPositionsInSector } from '../../repositories/asteroids.js';
import {
  findSectorByCoordinates,
  isUnknownFrontierCoordinate,
  listFrontierCoordinates,
  listNearestSectors,
} from '../../repositories/sectors.js';
import { payStationCosts } from '../../repositories/station-resources.js';
import {
  addDockedSpacecraft,
  listAvailableStationSpacecrafts,
  releaseSpacecraftClamped,
  reserveSpacecraft,
  takeLockedSpacecraft,
} from '../../repositories/station-spacecrafts.js';
import {
  countActiveStationsByUser,
  findOwnedStationInSector,
  findOwnedStationWithSector,
  findOwnedStationWithSectorForUpdate,
  findStation,
  listActiveStationPositionsInSector,
  listActiveStationSectorIdsByUser,
} from '../../repositories/stations.js';
import {
  countMovingWorldMissionsByUser,
  findDueWorldMissionForUpdate,
  findWorldMission,
  hasTravelingWorldMission,
  insertWorldMission,
  listDueWorldMissionIds,
  listReservedColonyPositions,
  listWorldMissionsByUser,
  lockSectorColonization,
  lockUserWorldMissions,
  updateWorldMission,
  type WorldMissionRow,
} from '../../repositories/world-missions.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { SeededRng } from '../../lib/world-gen/rng.js';
import { calcArrivesAt, calcDistance, calcTravelHours } from '../../lib/travel.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { insertSeededStation } from '../station/index.js';
import { ensureSector } from '../map/index.js';
import {
  applyTravelSpeed,
  getResearchModifiers,
  getStationResearchModifiers,
} from '../research/index.js';
import {
  createRealtimeExecutionContext,
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { completionEventId, type PlaytestCompletionEvent } from '../../lib/completion-events.js';

const logger = rootLogger.child({ name: 'world-missions' });

const sectorCenter = (sectorX: number, sectorY: number) => ({
  x: sectorX * WORLD_CONFIG.SECTOR.WIDTH,
  y: sectorY * WORLD_CONFIG.SECTOR.HEIGHT,
});

const fastestAvailable = <T extends { spacecraftKey: string }>(rows: T[], role?: 'miner') =>
  rows
    .map((row) => ({ ...row, definition: requireSpacecraft(row.spacecraftKey) }))
    .filter((row) => row.definition.speed > 0 && (!role || row.definition.role === role))
    .sort((a, b) => b.definition.speed - a.definition.speed)[0];

/** Research limits for expeditions and colonies; shared by the frontier view and the starts. */
async function worldMissionLimits(db: QueryDb, userId: string) {
  const [modifiers, expeditions, stationCount, colonizations] = await Promise.all([
    getResearchModifiers(db, userId),
    countMovingWorldMissionsByUser(db, userId, 'expedition'),
    countActiveStationsByUser(db, userId),
    countMovingWorldMissionsByUser(db, userId, 'colonization'),
  ]);
  return {
    expeditions: {
      active: expeditions,
      limit: modifiers.expeditionLimit,
      canExplore: modifiers.canExplore,
    },
    colonization: {
      cost: calculateColonizationCost(stationCount),
      stations: stationCount + colonizations,
      limit: modifiers.stationLimit,
    },
  };
}

export async function getFrontierTargets(
  userId: string,
  stationId: string
): Promise<FrontierResponse> {
  const db = getDb();
  const station = await findOwnedStationWithSector(db, stationId, userId);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const [frontier, fastestShip, modifiers, limits] = await Promise.all([
    listFrontierCoordinates(db, station, WORLD_CONFIG.SECTOR, 32),
    listAvailableStationSpacecrafts(db, stationId),
    getStationResearchModifiers(db, stationId),
    worldMissionLimits(db, userId),
  ]);
  const fastest = fastestAvailable(fastestShip);

  const targets = frontier
    .map(({ sectorX, sectorY }) => {
      const center = sectorCenter(sectorX, sectorY);
      const distance = calcDistance(station, center);
      return {
        sectorX,
        sectorY,
        ...center,
        distance,
        travelHours: fastest
          ? calcTravelHours(distance, fastest.definition.speed) / modifiers.speed
          : null,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sectorY - right.sectorY ||
        left.sectorX - right.sectorX
    );
  return { targets, ...limits };
}

export async function getKnownSectors(userId: string, stationId: string): Promise<KnownSector[]> {
  const db = getDb();
  const station = await findOwnedStationWithSector(db, stationId, userId);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  const [sectorRows, ownStations, fastestShip, modifiers] = await Promise.all([
    listNearestSectors(db, station, WORLD_CONFIG.SECTOR, 32),
    listActiveStationSectorIdsByUser(db, userId),
    listAvailableStationSpacecrafts(db, stationId),
    getStationResearchModifiers(db, stationId),
  ]);
  const ownSectorIds = new Set(ownStations.map((entry) => entry.sectorId));
  const fastestMiner = fastestAvailable(fastestShip, 'miner');
  return sectorRows
    .map((sector): KnownSector => {
      const center = sectorCenter(sector.sectorX, sector.sectorY);
      const distance = calcDistance(station, center);
      return {
        id: sector.id,
        sectorX: sector.sectorX,
        sectorY: sector.sectorY,
        role: sector.role,
        hasOwnStation: ownSectorIds.has(sector.id),
        ...center,
        distance,
        travelHours: fastestMiner
          ? calcTravelHours(distance, fastestMiner.definition.speed) / modifiers.speed
          : null,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sectorY - right.sectorY ||
        left.sectorX - right.sectorX
    );
}

async function lockAvailableShip(tx: Tx, stationId: string, role?: 'miner') {
  const rows = await listAvailableStationSpacecrafts(tx, stationId);
  const available = fastestAvailable(rows, role);
  const ship = available && {
    stationSpacecraftId: available.stationSpacecraftId,
    spacecraftKey: available.spacecraftKey,
    speed: available.definition.speed,
  };
  if (!ship) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      role === 'miner' ? 'No miner is available' : 'No spacecraft is available'
    );
  }

  const locked = await reserveSpacecraft(tx, ship.stationSpacecraftId, 1);
  if (!locked) throw new AppError(ErrorCode.VALIDATION_ERROR, 'No spacecraft is available');
  return ship;
}

export async function startExpedition(
  params: {
    userId: string;
    stationId: string;
    sectorX: number;
    sectorY: number;
  },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<WorldMission> {
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    await lockUserWorldMissions(tx, params.userId);
    const station = await findOwnedStationWithSectorForUpdate(tx, params.stationId, params.userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    // The user lock above serializes starts, so the limit cannot be overrun.
    const { expeditions } = await worldMissionLimits(tx, params.userId);
    if (!expeditions.canExplore) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Requires Long-Range Survey');
    }
    if (expeditions.active >= expeditions.limit) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Expedition limit reached (${expeditions.active}/${expeditions.limit})`
      );
    }

    if (!(await isUnknownFrontierCoordinate(tx, params.sectorX, params.sectorY))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is not an unknown frontier sector');
    }
    const active = await hasTravelingWorldMission(tx, {
      userId: params.userId,
      missionType: 'expedition',
      sectorX: params.sectorX,
      sectorY: params.sectorY,
    });
    if (active) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Expedition already underway');

    const ship = await lockAvailableShip(tx, station.id);
    const departedAt = context.now;
    const target = sectorCenter(params.sectorX, params.sectorY);
    const arrivesAt = await applyTravelSpeed(
      tx,
      station.id,
      calcArrivesAt(departedAt, calcDistance(station, target), ship.speed),
      departedAt
    );
    return insertWorldMission(tx, {
      id: context.nextId('world-mission'),
      userId: params.userId,
      originStationId: station.id,
      stationSpacecraftId: ship.stationSpacecraftId,
      spacecraftKey: ship.spacecraftKey,
      missionType: 'expedition',
      targetSectorX: params.sectorX,
      targetSectorY: params.sectorY,
      departedAt,
      arrivesAt,
      createdAt: context.now,
    });
  });
  return missionWithSpacecraftName(mission.id);
}

async function colonyPosition(
  tx: Tx,
  sector: { id: string; seed: string; sectorX: number; sectorY: number },
  userId: string
) {
  const [asteroidRows, stationRows, reservedPositions] = await Promise.all([
    listAsteroidPositionsInSector(tx, sector.id),
    listActiveStationPositionsInSector(tx, sector.id),
    listReservedColonyPositions(tx, sector.sectorX, sector.sectorY),
  ]);
  const occupiedPositions = [
    ...stationRows,
    ...reservedPositions.flatMap((position) =>
      position.x === null || position.y === null ? [] : [{ x: position.x, y: position.y }]
    ),
  ];
  const center = sectorCenter(sector.sectorX, sector.sectorY);
  const halfWidth = WORLD_CONFIG.SECTOR.WIDTH / 2;
  const halfHeight = WORLD_CONFIG.SECTOR.HEIGHT / 2;
  const rng = new SeededRng(`${sector.seed}:colony:${userId}`);
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const point = {
      x: Math.round(rng.nextFloat(center.x - halfWidth + 1_000, center.x + halfWidth - 1_000)),
      y: Math.round(rng.nextFloat(center.y - halfHeight + 1_000, center.y + halfHeight - 1_000)),
    };
    const clearOfStations = occupiedPositions.every(
      (station) => calcDistance(station, point) >= WORLD_CONFIG.SECTOR.SAFE_SPAWN_RADIUS * 2
    );
    const clearOfAsteroids = asteroidRows.every(
      (asteroid) => calcDistance(asteroid, point) >= WORLD_CONFIG.ASTEROID_MIN_DISTANCE * 2
    );
    if (clearOfStations && clearOfAsteroids) return point;
  }
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'No valid colony position is available');
}

export async function startColonization(
  params: {
    userId: string;
    stationId: string;
    sectorX: number;
    sectorY: number;
    name: string;
  },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<WorldMission> {
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    await lockUserWorldMissions(tx, params.userId);
    const station = await findOwnedStationWithSectorForUpdate(tx, params.stationId, params.userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const targetSector = await findSectorByCoordinates(tx, params.sectorX, params.sectorY);
    if (targetSector?.role !== 'frontier') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is not a discovered frontier sector');
    }
    await lockSectorColonization(tx, targetSector.id);
    const existing = await findOwnedStationInSector(tx, params.userId, targetSector.id);
    if (existing) throw new AppError(ErrorCode.ALREADY_EXISTS, 'You already have a station there');
    const { colonization } = await worldMissionLimits(tx, params.userId);
    if (colonization.stations >= colonization.limit) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Colony limit reached (${colonization.stations}/${colonization.limit}): research Colony Logistics`
      );
    }
    const colonyCost = colonization.cost;
    const active = await hasTravelingWorldMission(tx, {
      userId: params.userId,
      missionType: 'colonization',
      sectorX: params.sectorX,
      sectorY: params.sectorY,
    });
    if (active) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Colonization already underway');

    const short = await payStationCosts(tx, station.id, colonyCost);
    if (short) throw new AppError(ErrorCode.VALIDATION_ERROR, `Insufficient ${short.resourceKey}`);

    const ship = await lockAvailableShip(tx, station.id, 'miner');
    const target = await colonyPosition(tx, targetSector, params.userId);
    const departedAt = context.now;
    const arrivesAt = await applyTravelSpeed(
      tx,
      station.id,
      calcArrivesAt(departedAt, calcDistance(station, target), ship.speed),
      departedAt
    );
    return insertWorldMission(tx, {
      id: context.nextId('world-mission'),
      userId: params.userId,
      originStationId: station.id,
      stationSpacecraftId: ship.stationSpacecraftId,
      spacecraftKey: ship.spacecraftKey,
      missionType: 'colonization',
      targetSectorX: params.sectorX,
      targetSectorY: params.sectorY,
      targetX: target.x,
      targetY: target.y,
      colonyName: params.name,
      departedAt,
      arrivesAt,
      createdAt: context.now,
    });
  });
  return missionWithSpacecraftName(mission.id);
}

async function missionWithSpacecraftName(missionId: string): Promise<WorldMission> {
  const mission = await findWorldMission(getDb(), missionId);
  if (!mission) throw new Error('World mission disappeared');
  return toWorldMission(mission);
}

const toWorldMission = (mission: WorldMissionRow): WorldMission => ({
  id: mission.id,
  originStationId: mission.originStationId,
  missionType: mission.missionType,
  targetSectorX: mission.targetSectorX,
  targetSectorY: mission.targetSectorY,
  targetX: mission.targetX,
  targetY: mission.targetY,
  colonyName: mission.colonyName,
  status: mission.status,
  spacecraftName: requireSpacecraft(mission.spacecraftKey).name,
  departedAt: mission.departedAt.toISOString(),
  arrivesAt: mission.arrivesAt.toISOString(),
});

/** The frontier view lists the newest few; older missions only matter as history. */
const WORLD_MISSION_LIST_LIMIT = 50;

export async function getUserWorldMissions(userId: string): Promise<WorldMission[]> {
  const rows = await listWorldMissionsByUser(getDb(), userId, WORLD_MISSION_LIST_LIMIT);
  return rows.map(toWorldMission);
}

export interface WorldMissionCompletionResult {
  completed: number;
  failed: number;
  events: PlaytestCompletionEvent[];
}

/** One failing mission is logged and counted; the others still complete. */
export async function completeDueWorldMissions(
  contextOrNow?: GameExecutionContext | Date
): Promise<WorldMissionCompletionResult> {
  const context = resolveGameExecutionContext(contextOrNow);
  const { now } = context;
  const db = getDb();
  const due = await listDueWorldMissionIds(db, now);
  let completed = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const candidate of due) {
    try {
      const completion = await completeWorldMission(candidate.id, context);
      if (!completion) continue;
      completed += 1;
      events.push(...completion);
    } catch (error) {
      failed += 1;
      logger.error({ missionId: candidate.id, err: error }, 'Failed to complete world mission');
    }
  }
  return { completed, failed, events };
}

/** Completes one due mission; null if another worker got there first. */
async function completeWorldMission(
  missionId: string,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[] | null> {
  const { now } = context;
  const result = await getDb().transaction(async (tx) => {
    const mission = await findDueWorldMissionForUpdate(tx, missionId, now);
    if (!mission) return null;
    const eventContext = context.at(mission.arrivesAt);
    let stage: 'target_reached' | 'returned' | 'arrived';
    let colonyStationId: string | null = null;

    if (mission.status === 'returning') {
      stage = 'returned';
      await releaseSpacecraftClamped(tx, mission.stationSpacecraftId, 1);
      await updateWorldMission(tx, mission.id, { status: 'arrived' });
    } else if (mission.missionType === 'expedition') {
      stage = 'target_reached';
      await ensureSector(
        tx,
        mission.targetSectorX,
        mission.targetSectorY,
        'frontier',
        eventContext
      );
      const origin = await findStation(tx, mission.originStationId);
      const spacecraft = getSpacecraft(mission.spacecraftKey);
      if (!origin || !spacecraft) throw new Error('Expedition origin or spacecraft is missing');
      const departedAt = mission.arrivesAt;
      const target = sectorCenter(mission.targetSectorX, mission.targetSectorY);
      const returnArrivesAt = await applyTravelSpeed(
        tx,
        mission.originStationId,
        calcArrivesAt(departedAt, calcDistance(target, origin), spacecraft.speed),
        departedAt
      );
      await updateWorldMission(tx, mission.id, {
        status: 'returning',
        departedAt,
        arrivesAt: returnArrivesAt,
      });
    } else {
      stage = 'arrived';
      if (mission.targetX === null || mission.targetY === null || !mission.colonyName) {
        throw new Error('Colonization mission is incomplete');
      }
      const targetSector = await findSectorByCoordinates(
        tx,
        mission.targetSectorX,
        mission.targetSectorY
      );
      if (!targetSector) throw new Error('Colonization target sector no longer exists');
      const station = await insertSeededStation(
        tx,
        {
          userId: mission.userId,
          name: mission.colonyName,
          sectorId: targetSector.id,
          x: Math.round(mission.targetX),
          y: Math.round(mission.targetY),
        },
        eventContext,
        {}
      );
      colonyStationId = station.id;
      const moved = await takeLockedSpacecraft(tx, mission.stationSpacecraftId);
      if (!moved) throw new Error('Colonization spacecraft is no longer available');
      await addDockedSpacecraft(tx, {
        id: eventContext.nextId('station-spacecraft'),
        stationId: station.id,
        spacecraftKey: mission.spacecraftKey,
        amount: 1,
        createdAt: eventContext.now,
        updatedAt: eventContext.now,
      });
      await updateWorldMission(tx, mission.id, { status: 'arrived' });
    }
    return {
      userId: mission.userId,
      id: mission.id,
      missionType: mission.missionType,
      originStationId: mission.originStationId,
      occurredAt: mission.arrivesAt,
      targetSectorX: mission.targetSectorX,
      targetSectorY: mission.targetSectorY,
      stage,
      colonyStationId,
    };
  });
  if (!result) return null;
  const events: PlaytestCompletionEvent[] = [
    {
      type: 'world_mission_completed',
      eventId: completionEventId('world_mission_completed', result.id, result.stage),
      occurredAt: result.occurredAt,
      userId: result.userId,
      stationId: result.originStationId,
      missionId: result.id,
      missionType: result.missionType,
      stage: result.stage,
    },
  ];
  if (result.colonyStationId) {
    events.push({
      type: 'colony_established',
      eventId: completionEventId('colony_established', result.id),
      occurredAt: result.occurredAt,
      userId: result.userId,
      stationId: result.originStationId,
      missionId: result.id,
      colonyStationId: result.colonyStationId,
      sectorX: result.targetSectorX,
      sectorY: result.targetSectorY,
    });
  }
  publishUserEvent(result.userId, 'world_mission_completed', {
    missionId: result.id,
    missionType: result.missionType,
  });
  return events;
}
