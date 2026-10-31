import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { defenseUpgradeKeys, isOneOf } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { getUserScannerCoverages } from '../../src/services/station/scanner-coverage.js';
import { getStationBuildings, startBuildingUpgrade } from '../../src/services/station/buildings.js';
import {
  getStationDefenseUpgrades,
  startDefenseUpgrade,
} from '../../src/services/station/defense.js';
import { runSimulationTick } from '../../src/services/simulation/simulation.js';
import { getStationHangar } from '../../src/services/station/spacecraft.js';
import { getStationStorageCapacity } from '../../src/services/station/resources.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
  setTestResources,
} from '../helpers/fixtures.js';

let userId = '';
let sectorId = '';
let stationId = '';

before(async () => {
  await runMigrations();
  await initDb();
});

beforeEach(async () => {
  const user = await createTestUser();
  const sector = await createTestSector();
  const station = await createTestStation({ userId: user.id, sectorId: sector.id });
  userId = user.id;
  sectorId = sector.id;
  stationId = station.id;
  await setTestResources(stationId, {
    carbon: 10_000,
    titanium: 10_000,
    hydrogenium: 10_000,
    kyber_crystal: 10_000,
    astatine: 10_000,
  });
});

afterEach(async () => {
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
});

after(closeDb);

test('a completed hangar upgrade increases the effective hangar capacity', async () => {
  assert.deepEqual(await getStationHangar(stationId), { capacity: 20, used: 6 });

  await completeUpgrade('hangar');

  assert.deepEqual(await getStationHangar(stationId), { capacity: 31, used: 6 });
});

test('a completed warehouse upgrade increases per-resource storage capacity', async () => {
  assert.equal(await getStationStorageCapacity(stationId), 5_000);

  await completeUpgrade('warehouse');

  assert.equal(await getStationStorageCapacity(stationId), 7_300);
});

test('a completed scanner upgrade increases the station scanner range', async () => {
  assert.equal((await getUserScannerCoverages(userId))[0]?.range, 1_000);

  await completeUpgrade('scanner');

  assert.equal((await getUserScannerCoverages(userId))[0]?.range, 1_500);
});

test('defense upgrades are managed outside station buildings', async () => {
  assert.equal(
    (await getStationBuildings(stationId)).some((building) =>
      isOneOf(defenseUpgradeKeys, building.definition.key)
    ),
    false
  );

  // Guardian Cannon unlocks with Weapons 4, Shields 2 and Core 5.
  await grantResearch(userId, { weapons: 4, shields: 2 });
  await getDb()
    .update(stationBuildings)
    .set({ level: 5 })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'core'))
    );
  const before = (await getStationDefenseUpgrades(stationId, userId)).find(
    (upgrade) => upgrade.definition.key === 'guardian_cannon'
  );
  assert.equal(before?.level, 0);
  assert.deepEqual(before.effects, [{ type: 'defense_score', value: 0 }]);
  // 120 s base, shortened by the Core 5 build speed like a real start.
  assert.equal(before.upgradeDurationSeconds, 110);

  await completeDefenseUpgrade('guardian_cannon');

  const after = (await getStationDefenseUpgrades(stationId, userId)).find(
    (upgrade) => upgrade.definition.key === 'guardian_cannon'
  );
  assert.equal(after?.level, 1);
  assert.deepEqual(after.effects, [{ type: 'defense_score', value: 12 }]);
});

async function completeUpgrade(buildingKey: 'hangar' | 'scanner' | 'warehouse'): Promise<void> {
  await startBuildingUpgrade(stationId, buildingKey, userId);
  await completeProgressRow(buildingKey);
}

async function completeDefenseUpgrade(upgradeKey: 'guardian_cannon'): Promise<void> {
  await startDefenseUpgrade(stationId, upgradeKey, userId);
  await completeProgressRow(upgradeKey);
}

async function completeProgressRow(key: string): Promise<void> {
  const completedAt = new Date();
  await getDb()
    .update(stationBuildings)
    .set({ upgradeEndsAt: completedAt })
    .where(and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, key)));
  await runSimulationTick(completedAt);
}
