import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  AppError,
  type KnownSector,
  ErrorCode,
  type FrontierTarget,
  type WorldMission,
} from '@orions-frontier/shared';
import { COLONIZATION_COST, getSpacecraft } from '@orions-frontier/game-config';
import { getDb } from '../lib/db/index.js';
import { asteroids } from '../lib/db/schema/asteroids.js';
import { sectors } from '../lib/db/schema/sectors.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { worldMissions } from '../lib/db/schema/world-missions.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { SeededRng } from '../lib/world-gen/rng.js';
import { calcArrivesAt, calcDistance, calcTravelHours } from '../lib/travel.js';
import { publishUserEvent } from '../lib/realtime.js';
import { seedStationBuildings } from './building.service.js';
import { seedStationDefenseUpgrades } from './defense.service.js';
import { ensureSector } from './sector.service.js';
import { seedStationResources } from './station-resource.service.js';

const sectorCenter = (sectorX: number, sectorY: number) => ({
  x: sectorX * WORLD_CONFIG.SECTOR.WIDTH,
  y: sectorY * WORLD_CONFIG.SECTOR.HEIGHT,
});

type FrontierDb = Pick<ReturnType<typeof getDb>, 'execute'>;

async function nearestFrontierCoordinates(
  db: FrontierDb,
  origin: { x: number; y: number },
  limit = 32
): Promise<{ sectorX: number; sectorY: number }[]> {
  return db.execute(sql<{ sectorX: number; sectorY: number }>`
    with candidates as (
      select distinct
        s.sector_x + direction.dx as "sectorX",
        s.sector_y + direction.dy as "sectorY"
      from ${sectors} s
      cross join (values (1, 0), (-1, 0), (0, 1), (0, -1)) as direction(dx, dy)
      where not exists (
        select 1
        from ${sectors} existing
        where existing.sector_x = s.sector_x + direction.dx
          and existing.sector_y = s.sector_y + direction.dy
      )
    )
    select "sectorX", "sectorY"
    from candidates
    order by
      power("sectorX" * ${WORLD_CONFIG.SECTOR.WIDTH} - ${origin.x}, 2) +
      power("sectorY" * ${WORLD_CONFIG.SECTOR.HEIGHT} - ${origin.y}, 2),
      "sectorY",
      "sectorX"
    limit ${limit}
  `);
}

async function isUnknownFrontierCoordinate(
  db: FrontierDb,
  sectorX: number,
  sectorY: number
): Promise<boolean> {
  const rows = await db.execute(sql<{ found: number }>`
    select 1 as found
    where not exists (
      select 1 from ${sectors}
      where ${sectors.sectorX} = ${sectorX} and ${sectors.sectorY} = ${sectorY}
    ) and exists (
      select 1 from ${sectors}
      where abs(${sectors.sectorX} - ${sectorX}) + abs(${sectors.sectorY} - ${sectorY}) = 1
    )
  `);
  return rows.length > 0;
}

const fastestAvailable = <T extends { spacecraftKey: string }>(rows: T[], role?: 'miner') =>
  rows
    .map((row) => ({ ...row, definition: getSpacecraft(row.spacecraftKey)! }))
    .filter((row) => row.definition.speed > 0 && (!role || row.definition.role === role))
    .sort((a, b) => b.definition.speed - a.definition.speed)[0];

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

  const [frontier, fastestShip] = await Promise.all([
    nearestFrontierCoordinates(db, station),
    db
      .select({ spacecraftKey: stationSpacecrafts.spacecraftKey })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`
        )
      ),
  ]);
  const fastest = fastestAvailable(fastestShip);

  return frontier
    .map(({ sectorX, sectorY }) => {
      const center = sectorCenter(sectorX, sectorY);
      const distance = calcDistance(station, center);
      return {
        sectorX,
        sectorY,
        ...center,
        distance,
        travelHours: fastest ? calcTravelHours(distance, fastest.definition.speed) : null,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sectorY - right.sectorY ||
        left.sectorX - right.sectorX
    );
}

export async function getKnownSectors(userId: string, stationId: string): Promise<KnownSector[]> {
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
  const [sectorRows, ownStations, fastestShip] = await Promise.all([
    db
      .select()
      .from(sectors)
      .orderBy(
        sql`power(${sectors.sectorX} * ${WORLD_CONFIG.SECTOR.WIDTH} - ${station.x}, 2) + power(${sectors.sectorY} * ${WORLD_CONFIG.SECTOR.HEIGHT} - ${station.y}, 2)`,
        asc(sectors.sectorY),
        asc(sectors.sectorX)
      )
      .limit(32),
    db.select({ sectorId: stations.sectorId }).from(stations).where(eq(stations.userId, userId)),
    db
      .select({ spacecraftKey: stationSpacecrafts.spacecraftKey })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`
        )
      ),
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
        role: sector.role as KnownSector['role'],
        hasOwnStation: ownSectorIds.has(sector.id),
        ...center,
        distance,
        travelHours: fastestMiner ? calcTravelHours(distance, fastestMiner.definition.speed) : null,
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
  const rows = await tx
    .select({
      stationSpacecraftId: stationSpacecrafts.id,
      spacecraftKey: stationSpacecrafts.spacecraftKey,
    })
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        sql`${stationSpacecrafts.amount} > ${stationSpacecrafts.lockedAmount}`
      )
    );
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

    if (!(await isUnknownFrontierCoordinate(tx, params.sectorX, params.sectorY))) {
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
        spacecraftKey: ship.spacecraftKey,
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
        spacecraftKey: ship.spacecraftKey,
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
    .select()
    .from(worldMissions)
    .where(eq(worldMissions.id, missionId));
  if (!mission) throw new Error('World mission disappeared');
  return {
    id: mission.id,
    originStationId: mission.originStationId,
    missionType: mission.missionType as WorldMission['missionType'],
    targetSectorX: mission.targetSectorX,
    targetSectorY: mission.targetSectorY,
    targetX: mission.targetX,
    targetY: mission.targetY,
    colonyName: mission.colonyName,
    status: mission.status as WorldMission['status'],
    spacecraftName: getSpacecraft(mission.spacecraftKey)!.name,
    departedAt: mission.departedAt.toISOString(),
    arrivesAt: mission.arrivesAt.toISOString(),
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
        const [origin] = await tx
          .select({ x: stations.x, y: stations.y })
          .from(stations)
          .where(eq(stations.id, mission.originStationId));
        const spacecraft = getSpacecraft(mission.spacecraftKey);
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
            chunkX: Math.floor(mission.targetX / WORLD_CONFIG.CHUNK_SIZE),
            chunkY: Math.floor(mission.targetY / WORLD_CONFIG.CHUNK_SIZE),
          })
          .returning({ id: stations.id });
        await seedStationResources(station!.id, tx, {});
        await seedStationBuildings(station!.id, tx);
        await seedStationDefenseUpgrades(station!.id, tx);
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
            spacecraftKey: mission.spacecraftKey,
            amount: 1,
          })
          .onConflictDoUpdate({
            target: [stationSpacecrafts.stationId, stationSpacecrafts.spacecraftKey],
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
