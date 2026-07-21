import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ResourceMap } from '@orions-frontier/shared';
import { getDb } from '../../src/lib/db/index.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { seedStationBuildings } from '../../src/services/building.service.js';
import { seedStationResources } from '../../src/services/station-resource.service.js';
import { seedStationSpacecrafts } from '../../src/services/spacecraft.service.js';

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
  const [station] = await getDb()
    .insert(stations)
    .values({
      id: randomUUID(),
      userId,
      sectorId,
      name: 'Test Station',
      x: 0,
      y: 0,
      ...overrides,
    })
    .returning();

  await Promise.all([
    seedStationBuildings(station!.id),
    seedStationResources(station!.id),
    seedStationSpacecrafts(station!.id),
  ]);
  return station!;
}

export async function setTestResources(stationId: string, amounts: ResourceMap): Promise<void> {
  const db = getDb();
  await Promise.all(
    Object.entries(amounts).map(([resourceKey, amount]) =>
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
