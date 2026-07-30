import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  buildings,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  calculateDefenseUpgradeBuildTime,
  defenseUpgrades,
  getResearchDefinition,
  getSpacecraft,
} from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids } from '../../src/lib/db/schema/asteroids.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResearch } from '../../src/lib/db/schema/station-research.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { createSeededExecutionContext } from '../../src/lib/game-execution-context.js';
import { getStationBuildings, startBuildingUpgrade } from '../../src/services/building.service.js';
import {
  getStationDefenseUpgrades,
  startDefenseUpgrade,
} from '../../src/services/defense.service.js';
import { startResearch } from '../../src/services/research.service.js';
import { buildSpacecrafts } from '../../src/services/spacecraft.service.js';
import { setTestResources, createTestSector, createTestUser } from '../helpers/fixtures.js';
import { createStation } from '../../src/services/station.service.js';

const virtualStart = new Date('2035-04-12T08:30:00.000Z');
let userId = '';
let sectorId = '';
let stationId = '';

before(async () => {
  await runMigrations();
  await initDb();

  const user = await createTestUser();
  const sector = await createTestSector();
  userId = user.id;
  sectorId = sector.id;

  await getDb().insert(spawnSlots).values({
    sectorId,
    slotIndex: 0,
    slotType: 'player',
    x: 120,
    y: -80,
  });

  stationId = (
    await createStation(
      userId,
      { name: 'Virtual Economy', sectorId },
      createSeededExecutionContext({
        now: virtualStart,
        seed: 'virtual-station',
        worldSeed: 'virtual-world',
      })
    )
  ).id;

  await setTestResources(stationId, {
    carbon: 100_000,
    titanium: 100_000,
    hydrogenium: 100_000,
    kyber_crystal: 100_000,
    astatine: 100_000,
  });
});

after(async () => {
  const db = getDb();
  await db.delete(stationResearch).where(eq(stationResearch.stationId, stationId));
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.update(spawnSlots).set({ stationId: null }).where(eq(spawnSlots.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(asteroids).where(eq(asteroids.sectorId, sectorId));
  await db.delete(spawnSlots).where(eq(spawnSlots.sectorId, sectorId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(eq(users.id, userId));
  await closeDb();
});

test('station creation gives all seeded rows deterministic IDs and virtual timestamps', async () => {
  const expected = createSeededExecutionContext({
    now: virtualStart,
    seed: 'virtual-station',
    worldSeed: 'virtual-world',
  });
  assert.equal(stationId, expected.nextId('station'));

  const rows = await getDb()
    .select()
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));
  const byKey = new Map(rows.map((row) => [row.buildingKey, row]));
  for (const definition of buildings) {
    const row = byKey.get(definition.key);
    assert.equal(row?.id, expected.nextId('station-building'));
    assert.equal(row?.createdAt.toISOString(), virtualStart.toISOString());
    assert.equal(row?.updatedAt.toISOString(), virtualStart.toISOString());
  }
  for (const definition of defenseUpgrades) {
    const row = byKey.get(definition.key);
    assert.equal(row?.id, expected.nextId('station-defense'));
    assert.equal(row?.createdAt.toISOString(), virtualStart.toISOString());
    assert.equal(row?.updatedAt.toISOString(), virtualStart.toISOString());
  }

  const [fleet] = await getDb()
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  assert.equal(fleet?.id, expected.nextId('station-spacecraft'));
  assert.equal(fleet?.createdAt.toISOString(), virtualStart.toISOString());

  const [station] = await getDb().select().from(stations).where(eq(stations.id, stationId));
  assert.equal(station?.createdAt.toISOString(), virtualStart.toISOString());
});

test('all economic work starts from one virtual time with deterministic work IDs', async () => {
  const actionContext = createSeededExecutionContext({
    now: new Date('2040-06-01T14:00:00.000Z'),
    seed: 'virtual-actions',
    worldSeed: 'virtual-world',
  });
  const expected = createSeededExecutionContext({
    now: actionContext.now,
    seed: 'virtual-actions',
    worldSeed: 'virtual-world',
  });

  await startBuildingUpgrade(stationId, 'warehouse', userId, actionContext);
  await startDefenseUpgrade(stationId, 'guardian_cannon', userId, actionContext);
  await startResearch(stationId, userId, 'extraction_algorithms', actionContext);
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], actionContext);

  const progress = await getDb()
    .select()
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    );
  assert.equal(
    progress[0]?.upgradeEndsAt?.toISOString(),
    new Date(
      actionContext.now.getTime() + calculateBuildingBuildTime('warehouse', 2) * 1000
    ).toISOString()
  );
  const afterBuildingCompletion = actionContext.at(
    new Date(progress[0]!.upgradeEndsAt!.getTime() + 1)
  );
  assert.equal(
    (await getStationBuildings(stationId, afterBuildingCompletion)).find(
      (building) => building.definition.key === 'warehouse'
    )?.isUpgrading,
    false
  );

  const [defense] = await getDb()
    .select()
    .from(stationBuildings)
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingKey, 'guardian_cannon')
      )
    );
  assert.equal(
    defense?.upgradeEndsAt?.toISOString(),
    new Date(
      actionContext.now.getTime() + calculateDefenseUpgradeBuildTime('guardian_cannon', 1) * 1000
    ).toISOString()
  );
  assert.equal(
    (await getStationDefenseUpgrades(stationId, actionContext)).find(
      (upgrade) => upgrade.definition.key === 'guardian_cannon'
    )?.isUpgrading,
    true
  );

  const [research] = await getDb()
    .select()
    .from(stationResearch)
    .where(eq(stationResearch.stationId, stationId));
  const researchDefinition = getResearchDefinition('extraction_algorithms')!;
  // startDefenseUpgrade attempts the backwards-compatible insert before locking the existing row.
  expected.nextId('station-defense');
  assert.equal(research?.id, expected.nextId('station-research'));
  assert.equal(research?.createdAt.toISOString(), actionContext.now.toISOString());
  assert.equal(
    research?.completesAt.toISOString(),
    new Date(actionContext.now.getTime() + researchDefinition.duration * 1000).toISOString()
  );

  const [order] = await getDb()
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  const mole = getSpacecraft('mole')!;
  const shipyardBonus =
    calculateBuildingEffect('shipyard', 1).find(
      (effect) => effect.type === 'spacecraft_production_bonus'
    )?.value ?? 0;
  assert.equal(order?.id, expected.nextId('spacecraft-build-order'));
  assert.equal(order?.createdAt.toISOString(), actionContext.now.toISOString());
  assert.equal(
    order?.endsAt.toISOString(),
    new Date(
      actionContext.now.getTime() +
        Math.ceil(mole.buildTime * Math.max(0.25, 1 - shipyardBonus / 100)) * 1000
    ).toISOString()
  );
});
