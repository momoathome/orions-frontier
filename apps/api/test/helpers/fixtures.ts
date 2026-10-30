import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { entriesOf, type ResearchLevels, type ResourceMap } from '@orions-frontier/shared';
import { getDb } from '../../src/lib/db/index.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { users } from '../../src/lib/db/schema/users.js';
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

export async function setTestResources(stationId: string, amounts: ResourceMap): Promise<void> {
  const db = getDb();
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
