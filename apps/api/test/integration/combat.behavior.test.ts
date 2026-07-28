import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { getUserCombatReports, startAttack } from '../../src/services/combat.service.js';
import { getStationHangar } from '../../src/services/spacecraft.service.js';
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
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1_000);
  const [attacker, defender, sector] = await Promise.all([
    createTestUser({ createdAt: oldDate }),
    createTestUser({ createdAt: oldDate }),
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
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, [attackerUserId, defenderUserId]));
});

after(closeDb);

test('combat resolves attacker and defender losses', async () => {
  assert.deepEqual(await getStationHangar(attackerStationId), { capacity: 20, used: 5 });
  assert.deepEqual(await getStationHangar(defenderStationId), { capacity: 20, used: 6 });

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
  assert.deepEqual(await getStationHangar(attackerStationId), { capacity: 20, used: 4 });
  assert.deepEqual(await getStationHangar(defenderStationId), { capacity: 20, used: 0 });
});

test('combat and salvage returns discard cargo above warehouse capacity', async () => {
  await setCarbon(attackerStationId, 1_490);
  await resolveAttack();
  assert.equal(await getCarbon(attackerStationId), 1_500);

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
  await setCarbon(attackerStationId, 1_490);
  await resolveSalvage(field.id);
  assert.equal(await getCarbon(attackerStationId), 1_500);
});

test('station defense score can repel an attack without defending spacecraft', async () => {
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 0 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, defenderStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );
  await getDb()
    .update(stationBuildings)
    .set({ level: 4 })
    .where(
      and(
        eq(stationBuildings.stationId, defenderStationId),
        eq(stationBuildings.buildingKey, 'guardian_cannon')
      )
    );

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

  const report = (await getUserCombatReports(attackerUserId)).find(
    (combatReport) => combatReport.id === started.id
  );
  assert.equal(report?.status, 'resolved');
  assert.equal(report?.winner, 'defender');
  assert.equal(report?.attackerLosses, 3);
  assert.equal(report?.defenderLosses, 0);
  assert.deepEqual(await getFleet(attackerStationId, 'merlin'), { amount: 0, lockedAmount: 0 });
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

test('debris can be salvaged and combat does not change station ownership', async () => {
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

  // Combat does not change station ownership
  const [defenderStation] = await getDb()
    .select({ userId: stations.userId })
    .from(stations)
    .where(eq(stations.id, defenderStationId));
  assert.equal(defenderStation?.userId, defenderUserId);
});

test('attack on a young protected account is rejected', async () => {
  const young = await createTestUser();
  const youngStation = await createTestStation({
    userId: young.id,
    sectorId,
    name: 'Young',
    x: 2,
  });
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, youngStation.id),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );

  const now = new Date(young.createdAt.getTime() + 1_000);
  await assert.rejects(
    startAttack({
      userId: attackerUserId,
      stationId: attackerStationId,
      targetStationId: youngStation.id,
      spacecraftKey: 'merlin',
      amount: 1,
      now,
    }),
    /protected from attacks/
  );

  // Cleanup: attack was rejected, no trip/mission created
  await getDb().delete(stationResources).where(eq(stationResources.stationId, youngStation.id));
  await getDb().delete(stationBuildings).where(eq(stationBuildings.stationId, youngStation.id));
  await getDb().delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, youngStation.id));
  await getDb().delete(stations).where(eq(stations.id, youngStation.id));
  await getDb().delete(users).where(eq(users.id, young.id));
});

test('attack on an account older than 24 hours is allowed', async () => {
  const oldUser = await createTestUser({
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
  });
  const oldStation = await createTestStation({
    userId: oldUser.id,
    sectorId,
    name: 'Old',
    x: 2,
  });
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, oldStation.id),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );

  const now = new Date(oldUser.createdAt.getTime() + 25 * 60 * 60 * 1_000 + 1_000);
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: oldStation.id,
    spacecraftKey: 'merlin',
    amount: 3,
    now,
  });
  assert.equal(started.winner, null); // still traveling

  // Resolve the combat
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  assert.equal(await settleTripArrival(outbound!), true);

  const report = (await getUserCombatReports(attackerUserId)).find((r) => r.id === started.id);
  assert.equal(report?.winner, 'attacker');

  // Cleanup: missions first (FK to trips), then trips, then rest
  await getDb().delete(combatMissions).where(eq(combatMissions.defenderStationId, oldStation.id));
  const fleets = await getDb()
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, oldStation.id));
  await getDb()
    .delete(spacecraftTrips)
    .where(
      inArray(
        spacecraftTrips.stationSpacecraftId,
        fleets.map((f) => f.id)
      )
    );
  await getDb().delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, oldStation.id));
  await getDb().delete(stationResources).where(eq(stationResources.stationId, oldStation.id));
  await getDb().delete(stationBuildings).where(eq(stationBuildings.stationId, oldStation.id));
  await getDb().delete(stations).where(eq(stations.id, oldStation.id));
  await getDb().delete(users).where(eq(users.id, oldUser.id));
});

test('attack protection is broken after the first own attack', async () => {
  // Create a young defender and an old defender
  const youngDefender = await createTestUser();
  const youngStation = await createTestStation({
    userId: youngDefender.id,
    sectorId,
    name: 'YoungDef',
    x: 2,
  });
  // Give youngDefender a mole and a fighter
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, youngStation.id),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );
  // Station only has 'mole' from seeding; add 'javelin' as fighter
  await getDb().insert(stationSpacecrafts).values({
    stationId: youngStation.id,
    spacecraftKey: 'javelin',
    amount: 2,
  });

  const oldDefender = await createTestUser({
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
  });
  const oldStation = await createTestStation({
    userId: oldDefender.id,
    sectorId,
    name: 'OldDef',
    x: 3,
  });
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, oldStation.id),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );

  // Before youngDefender's first attack, they should be protected
  const now = new Date(youngDefender.createdAt.getTime() + 1_000);
  await assert.rejects(
    startAttack({
      userId: attackerUserId,
      stationId: attackerStationId,
      targetStationId: youngStation.id,
      spacecraftKey: 'merlin',
      amount: 1,
      now,
    }),
    /protected from attacks/
  );

  // Young defender launches their first attack (against the old station)
  await startAttack({
    userId: youngDefender.id,
    stationId: youngStation.id,
    targetStationId: oldStation.id,
    spacecraftKey: 'javelin',
    amount: 1,
    now,
  });

  // After youngDefender's first attack, protection is broken → now attackable
  await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: youngStation.id,
    spacecraftKey: 'merlin',
    amount: 1,
    now,
  });

  // Cleanup: delete missions first (FK to trips), then trips, then stations
  await getDb()
    .delete(combatMissions)
    .where(inArray(combatMissions.defenderStationId, [oldStation.id, youngStation.id]));
  for (const stationId of [oldStation.id, youngStation.id]) {
    const fleets = await getDb()
      .select({ id: stationSpacecrafts.id })
      .from(stationSpacecrafts)
      .where(eq(stationSpacecrafts.stationId, stationId));
    await getDb()
      .delete(spacecraftTrips)
      .where(
        inArray(
          spacecraftTrips.stationSpacecraftId,
          fleets.map((f) => f.id)
        )
      );
    await getDb().delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
    await getDb().delete(stationResources).where(eq(stationResources.stationId, stationId));
    await getDb().delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
    await getDb().delete(stations).where(eq(stations.id, stationId));
  }
  await getDb()
    .delete(users)
    .where(inArray(users.id, [youngDefender.id, oldDefender.id]));
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

async function setCarbon(stationId: string, amount: number): Promise<void> {
  await getDb()
    .update(stationResources)
    .set({ amount })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
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
