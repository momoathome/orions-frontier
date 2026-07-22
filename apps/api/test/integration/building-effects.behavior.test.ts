import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { getUserScannerCoverages } from '../../src/services/scanner-visibility.service.js';
import { getStationBuildings, startBuildingUpgrade } from '../../src/services/building.service.js';
import {
  getStationDefenseUpgrades,
  startDefenseUpgrade,
} from '../../src/services/defense.service.js';
import { runSimulationTick } from '../../src/services/simulation.service.js';
import { getStationHangar } from '../../src/services/spacecraft.service.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
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
  const db = getDb();
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(eq(users.id, userId));
});

after(closeDb);

test('a completed hangar upgrade increases the effective hangar capacity', async () => {
  assert.deepEqual(await getStationHangar(stationId), { capacity: 10, used: 1 });

  await completeUpgrade('hangar');

  assert.deepEqual(await getStationHangar(stationId), { capacity: 15, used: 1 });
});

test('a completed scanner upgrade increases the station scanner range', async () => {
  assert.equal((await getUserScannerCoverages(userId))[0]?.range, 1_000);

  await completeUpgrade('scanner');

  assert.equal((await getUserScannerCoverages(userId))[0]?.range, 1_500);
});

test('defense upgrades are managed outside station buildings', async () => {
  assert.equal(
    (await getStationBuildings(stationId)).some(
      (building) => (building.definition.key as string) === 'guardian_cannon'
    ),
    false
  );

  const before = (await getStationDefenseUpgrades(stationId)).find(
    (upgrade) => upgrade.definition.key === 'guardian_cannon'
  );
  assert.equal(before?.level, 0);
  assert.deepEqual(before?.effects, [{ type: 'defense_score', value: 0 }]);
  assert.equal(before?.upgradeDurationSeconds, 120);

  await completeDefenseUpgrade('guardian_cannon');

  const after = (await getStationDefenseUpgrades(stationId)).find(
    (upgrade) => upgrade.definition.key === 'guardian_cannon'
  );
  assert.equal(after?.level, 1);
  assert.deepEqual(after?.effects, [{ type: 'defense_score', value: 12 }]);
});

async function completeUpgrade(buildingKey: 'hangar' | 'scanner'): Promise<void> {
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
