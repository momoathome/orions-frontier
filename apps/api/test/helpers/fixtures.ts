import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { entriesOf, type ResearchLevels, type ResourceMap } from '@orions-frontier/shared';
import { getDb } from '../../src/lib/db/index.js';
import { asteroids } from '../../src/lib/db/schema/asteroids.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { users } from '../../src/lib/db/schema/users.js';
import { worldMissions } from '../../src/lib/db/schema/world-missions.js';
import { seedStationBuildings } from '../../src/services/station/buildings.js';
import { seedStationDefenseUpgrades } from '../../src/services/station/defense.js';
import { seedStationResources } from '../../src/services/station/resources.js';
import { seedStationSpacecrafts } from '../../src/services/station/spacecraft.js';

export async function createTestUser(
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<typeof users.$inferSelect> {
  const suffix = randomUUID();
  const [user] = await getDb()
    .insert(users)
    .values({
      id: randomUUID(),
      username: `user-${suffix}`,
      email: `user-${suffix}@example.test`,
      passwordHash: 'not-used',
      ...overrides,
    })
    .returning();
  return user!;
}

export async function createTestSector(
  overrides: Partial<typeof sectors.$inferInsert> = {}
): Promise<typeof sectors.$inferSelect> {
  const id = randomUUID();
  const coordinate = 1_000_000 + (Number.parseInt(id.slice(0, 8), 16) % 1_000_000);
  const [sector] = await getDb()
    .insert(sectors)
    .values({
      id,
      sectorX: coordinate,
      sectorY: -coordinate,
      role: 'settlement',
      seed: `test-${id}`,
      ...overrides,
    })
    .returning();
  return sector!;
}

export async function createTestStation({
  userId,
  sectorId,
  ...overrides
}: {
  userId: string;
  sectorId: string;
} & Partial<typeof stations.$inferInsert>): Promise<typeof stations.$inferSelect> {
  const x = overrides.x ?? 0;
  const y = overrides.y ?? 0;
  const [station] = await getDb()
    .insert(stations)
    .values({
      id: randomUUID(),
      userId,
      sectorId,
      name: 'Test Station',
      x,
      y,
      chunkX: overrides.chunkX ?? Math.floor(x / 1_000),
      chunkY: overrides.chunkY ?? Math.floor(y / 1_000),
      ...overrides,
    })
    .returning();

  await Promise.all([
    seedStationBuildings(station!.id),
    seedStationDefenseUpgrades(station!.id),
    seedStationResources(station!.id),
    seedStationSpacecrafts(station!.id),
  ]);
  return station!;
}

/** Sets the given resources, or every resource of the station when `amounts` is a number. */
export async function setTestResources(
  stationId: string,
  amounts: ResourceMap | number
): Promise<void> {
  const db = getDb();
  if (typeof amounts === 'number') {
    await db
      .update(stationResources)
      .set({ amount: amounts })
      .where(eq(stationResources.stationId, stationId));
    return;
  }
  await Promise.all(
    entriesOf(amounts).map(([resourceKey, amount]) =>
      db
        .update(stationResources)
        .set({ amount })
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, resourceKey)
          )
        )
    )
  );
}

/** Sets completed research levels for the user, replacing earlier levels of the same technology. */
export async function grantResearch(userId: string, levels: ResearchLevels): Promise<void> {
  const rows = entriesOf(levels).map(([technologyKey, level]) => ({
    userId,
    technologyKey,
    level,
  }));
  if (rows.length === 0) return;
  await getDb()
    .insert(userResearch)
    .values(rows)
    .onConflictDoUpdate({
      target: [userResearch.userId, userResearch.technologyKey],
      set: { level: sql`excluded.level` },
    });
}

/**
 * Deletes test rows in foreign-key order. Also removes stations owned by the given users (e.g.
 * colonies founded during a test), never foreign stations in the given sectors. Trips,
 * assignments, veins, queued jobs, research, bot controllers and logbook entries go by cascade.
 */
export async function deleteTestData({
  userIds = [],
  stationIds = [],
  sectorIds = [],
}: {
  userIds?: string[];
  stationIds?: string[];
  sectorIds?: string[];
}): Promise<void> {
  const db = getDb();
  const stationRows = await db
    .select({ id: stations.id })
    .from(stations)
    .where(or(inArray(stations.id, stationIds), inArray(stations.userId, userIds)));
  const allStationIds = stationRows.map((station) => station.id);
  await db
    .delete(salvageMissions)
    .where(
      or(
        inArray(salvageMissions.userId, userIds),
        inArray(salvageMissions.stationId, allStationIds)
      )
    );
  await db
    .delete(combatMissions)
    .where(
      or(
        inArray(combatMissions.userId, userIds),
        inArray(combatMissions.attackerStationId, allStationIds),
        inArray(combatMissions.defenderStationId, allStationIds)
      )
    );
  await db
    .delete(worldMissions)
    .where(
      or(
        inArray(worldMissions.userId, userIds),
        inArray(worldMissions.originStationId, allStationIds)
      )
    );
  for (const table of [
    spacecraftBuildOrders,
    stationBuildings,
    stationResources,
    stationSpacecrafts,
  ]) {
    await db.delete(table).where(inArray(table.stationId, allStationIds));
  }
  await db
    .update(spawnSlots)
    .set({ stationId: null })
    .where(inArray(spawnSlots.stationId, allStationIds));
  await db.delete(debrisFields).where(inArray(debrisFields.sectorId, sectorIds));
  await db.delete(stations).where(inArray(stations.id, allStationIds));
  await db.delete(asteroids).where(inArray(asteroids.sectorId, sectorIds));
  await db.delete(spawnSlots).where(inArray(spawnSlots.sectorId, sectorIds));
  await db.delete(sectors).where(inArray(sectors.id, sectorIds));
  await db.delete(users).where(inArray(users.id, userIds));
}
