import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  AppError,
  type DiscoveredSector,
  ErrorCode,
  type FrontierTarget,
  type WorldMission,
} from '@orions-frontier/shared';
import { COLONIZATION_COST } from '@orions-frontier/game-config';
import { getDb } from '../lib/db/index.js';
import { asteroids } from '../lib/db/schema/asteroids.js';
import { sectors } from '../lib/db/schema/sectors.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { worldMissions } from '../lib/db/schema/world-missions.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { SeededRng } from '../lib/world-gen/rng.js';
import { calcArrivesAt, calcDistance, calcTravelHours } from '../lib/travel.js';
import { publishUserEvent } from '../lib/realtime.js';
import { seedStationBuildings } from './building.service.js';
import { ensureSector } from './sector.service.js';
import { seedStationResources } from './station-resource.service.js';
import { getUserScannerStrength } from './asteroid.service.js';

const sectorCenter = (sectorX: number, sectorY: number) => ({
  x: sectorX * WORLD_CONFIG.SECTOR.WIDTH,
  y: sectorY * WORLD_CONFIG.SECTOR.HEIGHT,
});

const key = (sectorX: number, sectorY: number) => `${sectorX},${sectorY}`;

const isWithinScannerRange = (
  origin: { sectorX: number; sectorY: number },
  target: { sectorX: number; sectorY: number },
  scannerStrength: number
) =>
  Math.max(Math.abs(target.sectorX - origin.sectorX), Math.abs(target.sectorY - origin.sectorY)) <=
  1 + Math.floor(scannerStrength / 10);

const frontierCoordinates = (known: { sectorX: number; sectorY: number }[]) => {
  const occupied = new Set(known.map((sector) => key(sector.sectorX, sector.sectorY)));
  const candidates = new Map<string, { sectorX: number; sectorY: number }>();
  for (const sector of known) {
    for (const candidate of [
      { sectorX: sector.sectorX + 1, sectorY: sector.sectorY },
      { sectorX: sector.sectorX - 1, sectorY: sector.sectorY },
      { sectorX: sector.sectorX, sectorY: sector.sectorY + 1 },
      { sectorX: sector.sectorX, sectorY: sector.sectorY - 1 },
    ]) {
      const candidateKey = key(candidate.sectorX, candidate.sectorY);
      if (!occupied.has(candidateKey)) candidates.set(candidateKey, candidate);
    }
  }
  return [...candidates.values()];
};

export async function getFrontierTargets(
  userId: string,
  stationId: string
): Promise<FrontierTarget[]> {
  const db = getDb();
  const [station] = await db
    .select({
      x: stations.x,
      y: stations.y,
      sectorX: sectors.sectorX,
      sectorY: sectors.sectorY,
    })
    .from(stations)
    .innerJoin(sectors, eq(stations.sectorId, sectors.id))
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
    .limit(1);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const [known, fastestShip, scannerStrength] = await Promise.all([
    db.select({ sectorX: sectors.sectorX, sectorY: sectors.sectorY }).from(sectors),
    db
      .select({ speed: spacecraftDefinitions.speed })
      .from(stationSpacecrafts)
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`,
          sql`${spacecraftDefinitions.speed} > 0`
        )
      )
      .orderBy(desc(spacecraftDefinitions.speed))
      .limit(1),
    getUserScannerStrength(userId),
  ]);

  return frontierCoordinates(known)
    .filter((target) => isWithinScannerRange(station, target, scannerStrength))
    .map(({ sectorX, sectorY }) => {
      const center = sectorCenter(sectorX, sectorY);
      const distance = calcDistance(station, center);
      return {
        sectorX,
        sectorY,
        ...center,
        distance,
        travelHours: fastestShip[0] ? calcTravelHours(distance, fastestShip[0].speed) : null,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sectorY - right.sectorY ||
        left.sectorX - right.sectorX
    );
}

export async function getDiscoveredSectors(
  userId: string,
  stationId: string
): Promise<DiscoveredSector[]> {
  const db = getDb();
  const [station] = await db
    .select({
      x: stations.x,
      y: stations.y,
      sectorX: sectors.sectorX,
      sectorY: sectors.sectorY,
    })
    .from(stations)
    .innerJoin(sectors, eq(stations.sectorId, sectors.id))
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
    .limit(1);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  const [sectorRows, ownStations, fastestShip, scannerStrength] = await Promise.all([
    db.select().from(sectors),
    db.select({ sectorId: stations.sectorId }).from(stations).where(eq(stations.userId, userId)),
    db
      .select({ speed: spacecraftDefinitions.speed })
      .from(stationSpacecrafts)
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`,
          sql`${spacecraftDefinitions.speed} > 0`,
          eq(spacecraftDefinitions.role, 'miner')
        )
      )
      .orderBy(desc(spacecraftDefinitions.speed))
      .limit(1),
    getUserScannerStrength(userId),
  ]);
  const ownSectorIds = new Set(ownStations.map((entry) => entry.sectorId));
  return sectorRows
    .filter((sector) => isWithinScannerRange(station, sector, scannerStrength))
    .map((sector): DiscoveredSector => {
      const center = sectorCenter(sector.sectorX, sector.sectorY);
      const distance = calcDistance(station, center);
      return {
        id: sector.id,
        sectorX: sector.sectorX,
        sectorY: sector.sectorY,
        role: sector.role as DiscoveredSector['role'],
        hasOwnStation: ownSectorIds.has(sector.id),
        ...center,
        distance,
        travelHours: fastestShip[0] ? calcTravelHours(distance, fastestShip[0].speed) : null,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sectorY - right.sectorY ||
        left.sectorX - right.sectorX
    );
}

async function lockAvailableShip(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  stationId: string,
  role?: 'miner'
) {
  const conditions = [
    eq(stationSpacecrafts.stationId, stationId),
    sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`,
    sql`${spacecraftDefinitions.speed} > 0`,
  ];
  if (role) conditions.push(eq(spacecraftDefinitions.role, role));
  const [ship] = await tx
    .select({
      stationSpacecraftId: stationSpacecrafts.id,
      spacecraftDefinitionId: spacecraftDefinitions.id,
      speed: spacecraftDefinitions.speed,
    })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(and(...conditions))
    .orderBy(desc(spacecraftDefinitions.speed))
    .limit(1);
  if (!ship) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      role === 'miner' ? 'No miner is available' : 'No spacecraft is available'
    );
  }

  const [locked] = await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + 1` })
    .where(
      and(
        eq(stationSpacecrafts.id, ship.stationSpacecraftId),
        sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`
      )
    )
    .returning({ id: stationSpacecrafts.id });
  if (!locked) throw new AppError(ErrorCode.VALIDATION_ERROR, 'No spacecraft is available');
  return ship;
}

export async function startExpedition(params: {
  userId: string;
  stationId: string;
  sectorX: number;
  sectorY: number;
}): Promise<WorldMission> {
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.userId}))`);
    const [station] = await tx
      .select({
        id: stations.id,
        x: stations.x,
        y: stations.y,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
      })
      .from(stations)
      .innerJoin(sectors, eq(stations.sectorId, sectors.id))
      .where(and(eq(stations.id, params.stationId), eq(stations.userId, params.userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const scannerStrength = await getUserScannerStrength(params.userId);
    if (!isWithinScannerRange(station, params, scannerStrength)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is outside scanner range');
    }

    const known = await tx
      .select({ sectorX: sectors.sectorX, sectorY: sectors.sectorY })
      .from(sectors);
    if (
      !frontierCoordinates(known).some(
        (target) => target.sectorX === params.sectorX && target.sectorY === params.sectorY
      )
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is not an unknown frontier sector');
    }
    const [active] = await tx
      .select({ id: worldMissions.id })
      .from(worldMissions)
      .where(
        and(
          eq(worldMissions.userId, params.userId),
          eq(worldMissions.missionType, 'expedition'),
          eq(worldMissions.targetSectorX, params.sectorX),
          eq(worldMissions.targetSectorY, params.sectorY),
          eq(worldMissions.status, 'traveling')
        )
      )
      .limit(1);
    if (active) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Expedition already underway');

    const ship = await lockAvailableShip(tx, station.id);
    const departedAt = new Date();
    const target = sectorCenter(params.sectorX, params.sectorY);
    const arrivesAt = calcArrivesAt(departedAt, calcDistance(station, target), ship.speed);
    const [created] = await tx
      .insert(worldMissions)
      .values({
        userId: params.userId,
        originStationId: station.id,
        stationSpacecraftId: ship.stationSpacecraftId,
        spacecraftDefinitionId: ship.spacecraftDefinitionId,
        missionType: 'expedition',
        targetSectorX: params.sectorX,
        targetSectorY: params.sectorY,
        departedAt,
        arrivesAt,
      })
      .returning();
    return created!;
  });
  return missionWithSpacecraftName(mission.id);
}

async function colonyPosition(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  sector: { id: string; seed: string; sectorX: number; sectorY: number },
  userId: string
) {
  const [asteroidRows, stationRows, reservedPositions] = await Promise.all([
    tx
      .select({ x: asteroids.x, y: asteroids.y })
      .from(asteroids)
      .where(eq(asteroids.sectorId, sector.id)),
    tx
      .select({ x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.sectorId, sector.id)),
    tx
      .select({ x: worldMissions.targetX, y: worldMissions.targetY })
      .from(worldMissions)
      .where(
        and(
          eq(worldMissions.missionType, 'colonization'),
          eq(worldMissions.targetSectorX, sector.sectorX),
          eq(worldMissions.targetSectorY, sector.sectorY),
          eq(worldMissions.status, 'traveling'),
          sql`${worldMissions.targetX} is not null`,
          sql`${worldMissions.targetY} is not null`
        )
      ),
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

export async function startColonization(params: {
  userId: string;
  stationId: string;
  sectorX: number;
  sectorY: number;
  name: string;
}): Promise<WorldMission> {
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.userId}))`);
    const [station] = await tx
      .select({
        id: stations.id,
        x: stations.x,
        y: stations.y,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
      })
      .from(stations)
      .innerJoin(sectors, eq(stations.sectorId, sectors.id))
      .where(and(eq(stations.id, params.stationId), eq(stations.userId, params.userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const scannerStrength = await getUserScannerStrength(params.userId);
    if (!isWithinScannerRange(station, params, scannerStrength)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is outside scanner range');
    }
    const [targetSector] = await tx
      .select()
      .from(sectors)
      .where(and(eq(sectors.sectorX, params.sectorX), eq(sectors.sectorY, params.sectorY)))
      .limit(1);
    if (!targetSector || targetSector.role !== 'frontier') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target is not a discovered frontier sector');
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'colony:' + targetSector.id}))`);
    const [existing] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.userId, params.userId), eq(stations.sectorId, targetSector.id)))
      .limit(1);
    if (existing) throw new AppError(ErrorCode.ALREADY_EXISTS, 'You already have a station there');
    const [active] = await tx
      .select({ id: worldMissions.id })
      .from(worldMissions)
      .where(
        and(
          eq(worldMissions.userId, params.userId),
          eq(worldMissions.missionType, 'colonization'),
          eq(worldMissions.targetSectorX, params.sectorX),
          eq(worldMissions.targetSectorY, params.sectorY),
          eq(worldMissions.status, 'traveling')
        )
      )
      .limit(1);
    if (active) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Colonization already underway');

    const resourceRows = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, station.id))
      .for('update');
    const available = new Map(
      resourceRows.map((resource) => [resource.resourceKey, resource.amount])
    );
    for (const [resourceKey, amount] of Object.entries(COLONIZATION_COST)) {
      if ((available.get(resourceKey) ?? 0) < amount) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Insufficient ${resourceKey}`);
      }
    }
    for (const [resourceKey, amount] of Object.entries(COLONIZATION_COST)) {
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${amount}` })
        .where(
          and(
            eq(stationResources.stationId, station.id),
            eq(stationResources.resourceKey, resourceKey)
          )
        );
    }

    const ship = await lockAvailableShip(tx, station.id, 'miner');
    const target = await colonyPosition(tx, targetSector, params.userId);
    const departedAt = new Date();
    const arrivesAt = calcArrivesAt(departedAt, calcDistance(station, target), ship.speed);
    const [created] = await tx
      .insert(worldMissions)
      .values({
        userId: params.userId,
        originStationId: station.id,
        stationSpacecraftId: ship.stationSpacecraftId,
        spacecraftDefinitionId: ship.spacecraftDefinitionId,
        missionType: 'colonization',
        targetSectorX: params.sectorX,
        targetSectorY: params.sectorY,
        targetX: target.x,
        targetY: target.y,
        colonyName: params.name,
        departedAt,
        arrivesAt,
      })
      .returning();
    return created!;
  });
  return missionWithSpacecraftName(mission.id);
}

async function missionWithSpacecraftName(missionId: string): Promise<WorldMission> {
  const [mission] = await getDb()
    .select({ mission: worldMissions, spacecraftName: spacecraftDefinitions.name })
    .from(worldMissions)
    .innerJoin(
      spacecraftDefinitions,
      eq(worldMissions.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(worldMissions.id, missionId));
  if (!mission) throw new Error('World mission disappeared');
  return {
    id: mission.mission.id,
    originStationId: mission.mission.originStationId,
    missionType: mission.mission.missionType as WorldMission['missionType'],
    targetSectorX: mission.mission.targetSectorX,
    targetSectorY: mission.mission.targetSectorY,
    targetX: mission.mission.targetX,
    targetY: mission.mission.targetY,
    colonyName: mission.mission.colonyName,
    status: mission.mission.status as WorldMission['status'],
    spacecraftName: mission.spacecraftName,
    departedAt: mission.mission.departedAt.toISOString(),
    arrivesAt: mission.mission.arrivesAt.toISOString(),
  };
}

export async function getUserWorldMissions(userId: string): Promise<WorldMission[]> {
  const rows = await getDb()
    .select({ id: worldMissions.id })
    .from(worldMissions)
    .where(eq(worldMissions.userId, userId))
    .orderBy(desc(worldMissions.createdAt));
  return Promise.all(rows.map((row) => missionWithSpacecraftName(row.id)));
}

export async function completeDueWorldMissions(now = new Date()): Promise<number> {
  const db = getDb();
  const due = await db
    .select({ id: worldMissions.id })
    .from(worldMissions)
    .where(
      and(
        inArray(worldMissions.status, ['traveling', 'returning']),
        lte(worldMissions.arrivesAt, now)
      )
    )
    .orderBy(asc(worldMissions.arrivesAt), asc(worldMissions.id));
  let completed = 0;

  for (const candidate of due) {
    const result = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select()
        .from(worldMissions)
        .where(
          and(
            eq(worldMissions.id, candidate.id),
            inArray(worldMissions.status, ['traveling', 'returning']),
            lte(worldMissions.arrivesAt, now)
          )
        )
        .for('update');
      if (!mission) return null;

      if (mission.status === 'returning') {
        await tx
          .update(stationSpacecrafts)
          .set({ lockedAmount: sql`greatest(0, ${stationSpacecrafts.lockedAmount} - 1)` })
          .where(eq(stationSpacecrafts.id, mission.stationSpacecraftId));
        await tx
          .update(worldMissions)
          .set({ status: 'arrived' })
          .where(eq(worldMissions.id, mission.id));
      } else if (mission.missionType === 'expedition') {
        await ensureSector(tx, mission.targetSectorX, mission.targetSectorY, 'frontier');
        const [origin, spacecraft] = await Promise.all([
          tx
            .select({ x: stations.x, y: stations.y })
            .from(stations)
            .where(eq(stations.id, mission.originStationId))
            .then((rows) => rows[0]),
          tx
            .select({ speed: spacecraftDefinitions.speed })
            .from(spacecraftDefinitions)
            .where(eq(spacecraftDefinitions.id, mission.spacecraftDefinitionId))
            .then((rows) => rows[0]),
        ]);
        if (!origin || !spacecraft) throw new Error('Expedition origin or spacecraft is missing');
        const departedAt = mission.arrivesAt;
        const target = sectorCenter(mission.targetSectorX, mission.targetSectorY);
        await tx
          .update(worldMissions)
          .set({
            status: 'returning',
            departedAt,
            arrivesAt: calcArrivesAt(departedAt, calcDistance(target, origin), spacecraft.speed),
          })
          .where(eq(worldMissions.id, mission.id));
      } else if (mission.missionType === 'colonization') {
        if (mission.targetX === null || mission.targetY === null || !mission.colonyName) {
          throw new Error('Colonization mission is incomplete');
        }
        const [targetSector] = await tx
          .select({ id: sectors.id })
          .from(sectors)
          .where(
            and(
              eq(sectors.sectorX, mission.targetSectorX),
              eq(sectors.sectorY, mission.targetSectorY)
            )
          );
        if (!targetSector) throw new Error('Colonization target sector no longer exists');
        const [station] = await tx
          .insert(stations)
          .values({
            userId: mission.userId,
            name: mission.colonyName,
            sectorId: targetSector.id,
            x: Math.round(mission.targetX),
            y: Math.round(mission.targetY),
          })
          .returning({ id: stations.id });
        await seedStationResources(station!.id, tx, {});
        await seedStationBuildings(station!.id, tx);
        const [moved] = await tx
          .update(stationSpacecrafts)
          .set({
            amount: sql`${stationSpacecrafts.amount} - 1`,
            lockedAmount: sql`${stationSpacecrafts.lockedAmount} - 1`,
          })
          .where(
            and(
              eq(stationSpacecrafts.id, mission.stationSpacecraftId),
              sql`${stationSpacecrafts.amount} >= 1`,
              sql`${stationSpacecrafts.lockedAmount} >= 1`
            )
          )
          .returning({ id: stationSpacecrafts.id });
        if (!moved) throw new Error('Colonization spacecraft is no longer available');
        await tx
          .insert(stationSpacecrafts)
          .values({
            stationId: station!.id,
            spacecraftDefinitionId: mission.spacecraftDefinitionId,
            amount: 1,
          })
          .onConflictDoUpdate({
            target: [stationSpacecrafts.stationId, stationSpacecrafts.spacecraftDefinitionId],
            set: { amount: sql`${stationSpacecrafts.amount} + 1` },
          });
        await tx
          .update(worldMissions)
          .set({ status: 'arrived' })
          .where(eq(worldMissions.id, mission.id));
      } else {
        throw new Error(`Unknown world mission: ${mission.missionType}`);
      }
      return { userId: mission.userId, id: mission.id, missionType: mission.missionType };
    });
    if (!result) continue;
    completed += 1;
    publishUserEvent(result.userId, 'world_mission_completed', {
      missionId: result.id,
      missionType: result.missionType,
    });
  }
  return completed;
}
