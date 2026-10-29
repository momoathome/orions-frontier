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
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';
import { seedBotsForSector } from '../../src/services/bot/provision.js';
import { ensureSector, openNextSettlementSector } from '../../src/services/map/sector.js';
import { createStation } from '../../src/services/station/station.js';

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
  const db = getDb();
  const testSectorIds = [sectorId, openedSectorId].filter(Boolean);
  const stationRows = testSectorIds.length
    ? await db
        .select({ id: stations.id, userId: stations.userId })
        .from(stations)
        .where(inArray(stations.sectorId, testSectorIds))
    : [];
  const stationIds = stationRows.map((station) => station.id);
  const userIds = [...new Set([userId, ...stationRows.map((station) => station.userId)])];
  if (stationIds.length > 0) {
    await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
    await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
    await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
    await db
      .update(spawnSlots)
      .set({ stationId: null })
      .where(inArray(spawnSlots.stationId, stationIds));
    await db.delete(stations).where(inArray(stations.id, stationIds));
  }
  await db.delete(botControllers).where(inArray(botControllers.userId, userIds));
  if (testSectorIds.length > 0) {
    await db.delete(asteroids).where(inArray(asteroids.sectorId, testSectorIds));
    await db.delete(spawnSlots).where(inArray(spawnSlots.sectorId, testSectorIds));
    await db.delete(sectors).where(inArray(sectors.id, testSectorIds));
  }
  await db.delete(users).where(inArray(users.id, userIds));
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
