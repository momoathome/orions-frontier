import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { stationInfluence } from '../../src/lib/db/schema/station-influence.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { getUserCombatReports, startAttack } from '../../src/services/combat.service.js';
import { getStationInfluence, takeOverStation } from '../../src/services/influence.service.js';
import { startSalvage } from '../../src/services/salvage.service.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.service.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';

let attackerUserId = '';
let defenderUserId = '';
let attackerStationId = '';
let defenderStationId = '';
let sectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
});

beforeEach(async () => {
  const [attacker, defender, sector] = await Promise.all([
    createTestUser(),
    createTestUser(),
    createTestSector(),
  ]);
  attackerUserId = attacker.id;
  defenderUserId = defender.id;
  sectorId = sector.id;

  const [attackerStation, defenderStation] = await Promise.all([
    createTestStation({ userId: attacker.id, sectorId: sector.id, name: 'Attacker' }),
    createTestStation({ userId: defender.id, sectorId: sector.id, name: 'Defender', x: 1 }),
  ]);
  attackerStationId = attackerStation.id;
  defenderStationId = defenderStation.id;

  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'merlin',
    amount: 3,
  });
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, defenderStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );
});

afterEach(async () => {
  const db = getDb();
  const stationIds = [attackerStationId, defenderStationId];
  const fleets = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.stationId, stationIds));

  await db.delete(salvageMissions).where(inArray(salvageMissions.stationId, stationIds));
  await db.delete(combatMissions).where(inArray(combatMissions.attackerStationId, stationIds));
  if (fleets.length > 0) {
    await db.delete(spacecraftTrips).where(
      inArray(
        spacecraftTrips.stationSpacecraftId,
        fleets.map((fleet) => fleet.id)
      )
    );
  }
  await db.delete(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  await db.delete(stationInfluence).where(inArray(stationInfluence.stationId, stationIds));
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, [attackerUserId, defenderUserId]));
});

after(closeDb);

test('combat resolves attacker and defender losses', async () => {
  const report = await resolveAttack();

  assert.equal(report.status, 'resolved');
  assert.equal(report.winner, 'attacker');
  assert.equal(report.attackerLosses, 1);
  assert.equal(report.defenderLosses, 3);

  const [attackerFleet, defenderFleet] = await Promise.all([
    getFleet(attackerStationId, 'merlin'),
    getFleet(defenderStationId, 'mole'),
  ]);
  assert.deepEqual(attackerFleet, { amount: 2, lockedAmount: 0 });
  assert.deepEqual(defenderFleet, { amount: 0, lockedAmount: 0 });
});

test('a resolved attack transfers bounded loot and creates debris', async () => {
  const attackerCarbonBefore = await getCarbon(attackerStationId);
  const defenderCarbonBefore = await getCarbon(defenderStationId);

  const report = await resolveAttack();

  assert.deepEqual(report.loot, { carbon: 15, hydrogenium: 5 });
  assert.equal(await getCarbon(attackerStationId), attackerCarbonBefore + 15);
  assert.equal(await getCarbon(defenderStationId), defenderCarbonBefore - 15);
  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  assert.deepEqual(field?.resources, { carbon: 108, titanium: 78, hydrogenium: 45 });
});

test('debris can be salvaged and earned influence can take over a station', async () => {
  const attackerCarbonBefore = await getCarbon(attackerStationId);
  await resolveAttack();
  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  assert.ok(field);

  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'collector',
    amount: 1,
  });
  await resolveSalvage(field.id);

  assert.equal(await getCarbon(attackerStationId), attackerCarbonBefore + 15 + 108);
  assert.equal(
    (await getDb().select().from(debrisFields).where(eq(debrisFields.id, field.id))).length,
    0
  );
  assert.deepEqual(await getFleet(attackerStationId, 'collector'), {
    amount: 1,
    lockedAmount: 0,
  });

  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 1 })
    .where(eq(stationSpacecrafts.stationId, defenderStationId));
  const influence = await getStationInfluence(attackerUserId, defenderStationId);
  assert.deepEqual(
    { points: influence.points, defended: influence.defended, canTakeOver: influence.canTakeOver },
    { points: 1, defended: false, canTakeOver: true }
  );

  await takeOverStation(attackerUserId, defenderStationId);
  const [captured] = await getDb()
    .select({ userId: stations.userId })
    .from(stations)
    .where(eq(stations.id, defenderStationId));
  assert.equal(captured?.userId, attackerUserId);
  assert.equal(
    (
      await getDb()
        .select()
        .from(stationInfluence)
        .where(eq(stationInfluence.stationId, defenderStationId))
    ).length,
    0
  );
});

async function resolveAttack() {
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    spacecraftKey: 'merlin',
    amount: 3,
  });
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  assert.equal(await settleTripArrival(outbound!), true);

  const [returning] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [returnTrip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, returning!.returnTripId!));
  assert.equal(await settleTripArrival(returnTrip!), true);

  return (await getUserCombatReports(attackerUserId)).find((report) => report.id === started.id)!;
}

async function resolveSalvage(debrisFieldId: string): Promise<void> {
  const started = await startSalvage({
    userId: attackerUserId,
    stationId: attackerStationId,
    debrisFieldId,
    spacecraftKey: 'collector',
    amount: 1,
  });
  const [mission] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, started.id));
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  assert.equal(await settleTripArrival(outbound!), true);

  const [returning] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, started.id));
  const [returnTrip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, returning!.returnTripId!));
  assert.equal(await settleTripArrival(returnTrip!), true);
}

async function getCarbon(stationId: string): Promise<number> {
  const [resource] = await getDb()
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  return resource!.amount;
}

async function getFleet(stationId: string, spacecraftKey: string) {
  const [fleet] = await getDb()
    .select({ amount: stationSpacecrafts.amount, lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
      )
    );
  return fleet;
}
