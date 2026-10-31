import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids } from '../../src/lib/db/schema/asteroids.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';
import { seedBotsForSector } from '../../src/services/bot/provision.js';
import { ensureSector, openNextSettlementSector } from '../../src/services/map/sector.js';
import { createStation } from '../../src/services/station/station.js';
import { deleteTestData } from '../helpers/fixtures.js';

const userId = randomUUID();
let sectorId = '';
let openedSectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
  const suffix = randomUUID();
  await getDb()
    .insert(users)
    .values({
      id: userId,
      username: `world-${suffix.slice(0, 8)}`,
      email: `world-generation-${suffix}@example.test`,
      passwordHash: 'not-used',
    });
  sectorId = (await getDb().transaction((tx) => ensureSector(tx, 420, 420, 'settlement'))).id;
});

after(async () => {
  const testSectorIds = [sectorId, openedSectorId].filter(Boolean);
  // Bots seeded into the test sectors belong to this test, so their owners go too.
  const owners = await getDb()
    .select({ userId: stations.userId })
    .from(stations)
    .where(inArray(stations.sectorId, testSectorIds));
  await deleteTestData({
    userIds: [...new Set([userId, ...owners.map((owner) => owner.userId)])],
    sectorIds: testSectorIds,
  });
  await closeDb();
});

test('station founding creates one starter pocket and configured sector bots exactly once', async () => {
  const db = getDb();
  const beforeAsteroids = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.sectorId, sectorId));

  const station = await createStation(userId, { name: 'World Test', sectorId });
  assert.equal(station.sectorId, sectorId);
  const afterAsteroids = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.sectorId, sectorId));
  assert.equal(afterAsteroids.length - beforeAsteroids.length, 5);

  const interruptedBotId = randomUUID();
  await db.insert(users).values({
    id: interruptedBotId,
    username: 'orion-bot-p420-p420-1',
    email: 'orion-bot-p420-p420-1@system.invalid',
    passwordHash: 'disabled:test',
    role: 'bot',
  });
  await db.insert(botControllers).values({ userId: interruptedBotId });

  await Promise.all([seedBotsForSector(sectorId), seedBotsForSector(sectorId)]);
  const botStations = await db
    .select({ stationId: stations.id })
    .from(stations)
    .innerJoin(users, eq(stations.userId, users.id))
    .where(and(eq(stations.sectorId, sectorId), eq(users.role, 'bot')));
  assert.equal(botStations.length, WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT);

  // A destroyed bot station frees its slot but must not come back on the next provisioning.
  const destroyedId = botStations[0]!.stationId;
  await db.update(stations).set({ destroyedAt: new Date() }).where(eq(stations.id, destroyedId));
  await db.update(spawnSlots).set({ stationId: null }).where(eq(spawnSlots.stationId, destroyedId));
  const asteroidsBeforeReseed = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.sectorId, sectorId));
  await seedBotsForSector(sectorId);
  const botStationsAfter = await db
    .select({ stationId: stations.id })
    .from(stations)
    .innerJoin(users, eq(stations.userId, users.id))
    .where(and(eq(stations.sectorId, sectorId), eq(users.role, 'bot')));
  assert.equal(botStationsAfter.length, WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT);
  const asteroidsAfterReseed = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.sectorId, sectorId));
  assert.equal(asteroidsAfterReseed.length, asteroidsBeforeReseed.length);
});

test('opening the next settlement creates configured player and bot slots', async () => {
  const db = getDb();
  openedSectorId = await db.transaction((tx) => openNextSettlementSector(tx));
  const [opened] = await db
    .select({ role: sectors.role })
    .from(sectors)
    .where(eq(sectors.id, openedSectorId));
  const slots = await db.select().from(spawnSlots).where(eq(spawnSlots.sectorId, openedSectorId));

  assert.equal(opened?.role, 'settlement');
  assert.equal(slots.length, WORLD_CONFIG.SECTOR.STATION_CAPACITY);
  assert.equal(
    slots.filter((slot) => slot.slotType === 'bot').length,
    WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT
  );
});
