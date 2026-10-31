import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { getUserCombatReports, startAttack } from '../../src/services/combat/combat.js';
import { getStationHangar } from '../../src/services/station/spacecraft.js';
import { getDebrisById, startSalvage } from '../../src/services/combat/salvage.js';
import { resolveSalvageMissionByTrip } from '../../src/services/combat/repositories/debris-fields.js';
import { resolveCombatMissionByTrip } from '../../src/services/combat/repositories/combat-missions.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.js';
import { entriesOf, type CombatReport, type ResearchLevels } from '@orions-frontier/shared';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
  setTestResources,
} from '../helpers/fixtures.js';

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
  await deleteTestData({ userIds: [attackerUserId, defenderUserId], sectorIds: [sectorId] });
});

after(closeDb);

test('combat resolves attacker and defender losses', async () => {
  assert.deepEqual(await getStationHangar(attackerStationId), { capacity: 20, used: 9 });
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
  assert.deepEqual(await getStationHangar(attackerStationId), { capacity: 20, used: 8 });
  assert.deepEqual(await getStationHangar(defenderStationId), { capacity: 20, used: 0 });
});

test('combat and salvage returns discard cargo above warehouse capacity', async () => {
  await setTestResources(attackerStationId, { carbon: 4_990 });
  await resolveAttack();
  assert.equal(await getCarbon(attackerStationId), 5_000);

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
  await setTestResources(attackerStationId, { carbon: 4_990 });
  await resolveSalvage(field.id);
  assert.equal(await getCarbon(attackerStationId), 5_000);
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
    fleet: { merlin: 3 },
  });
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  assert.equal((await settleTripArrival(outbound!)).settled, true);

  const report = (await getUserCombatReports(attackerUserId)).find(
    (combatReport) => combatReport.id === started.id
  );
  assert.equal(report?.status, 'resolved');
  assert.equal(report.winner, 'defender');
  assert.equal(report.attackerLosses, 3);
  assert.equal(report.defenderLosses, 0);
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

// 3 Merlins (attack 15, defense 8, cargo 10) against Moles (defense 3) and defense upgrades.
const researchCases: {
  name: string;
  attacker?: ResearchLevels;
  defender?: ResearchLevels;
  moles?: number;
  armorPlating?: number;
  expected: Partial<CombatReport>;
}[] = [
  {
    name: 'without research 45 attack destroys 15 Moles',
    moles: 20,
    expected: { defenderLosses: 15 },
  },
  {
    name: 'Weapons raises the attack',
    attacker: { weapons: 4 },
    moles: 20,
    expected: { defenderLosses: 18 },
  },
  {
    name: 'Armor protects defending ships',
    defender: { armor: 4 },
    moles: 20,
    expected: { defenderLosses: 12 },
  },
  {
    name: 'Armor protects attacking ships',
    attacker: { armor: 4 },
    expected: { attackerLosses: 0 },
  },
  {
    name: 'Cargo Compression carries more loot',
    attacker: { cargo_compression: 4 },
    expected: { loot: { carbon: 15, hydrogenium: 9 } },
  },
  {
    name: 'without research Armor Plating 2 destroys one Merlin',
    moles: 0,
    armorPlating: 2,
    expected: { attackerLosses: 1 },
  },
  {
    name: 'Shields raise the station defense',
    defender: { shields: 7 },
    moles: 0,
    armorPlating: 2,
    expected: { attackerLosses: 2 },
  },
];

for (const { name, attacker, defender, moles, armorPlating, expected } of researchCases) {
  test(`combat research: ${name}`, async () => {
    await grantResearch(attackerUserId, attacker ?? {});
    await grantResearch(defenderUserId, defender ?? {});
    if (moles !== undefined) {
      await getDb()
        .update(stationSpacecrafts)
        .set({ amount: moles })
        .where(
          and(
            eq(stationSpacecrafts.stationId, defenderStationId),
            eq(stationSpacecrafts.spacecraftKey, 'mole')
          )
        );
    }
    if (armorPlating !== undefined) {
      await getDb()
        .update(stationBuildings)
        .set({ level: armorPlating })
        .where(
          and(
            eq(stationBuildings.stationId, defenderStationId),
            eq(stationBuildings.buildingKey, 'armor_plating')
          )
        );
    }

    const resolved = await report((await arriveWithAttack()).id);
    for (const [key, value] of entriesOf(expected)) {
      assert.deepEqual(resolved[key], value, key);
    }
  });
}

test('a salvage mission resolved by station loss does not block deleting its debris', async () => {
  await resolveAttack();
  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  await getDb()
    .insert(stationSpacecrafts)
    .values([
      { stationId: attackerStationId, spacecraftKey: 'collector', amount: 1 },
      { stationId: defenderStationId, spacecraftKey: 'collector', amount: 1 },
    ]);
  // The attacker's home is destroyed while its salvager flies; destruction resolves the mission.
  const { outbound } = await launchSalvage(field!.id);
  await getDb().transaction((tx) =>
    resolveSalvageMissionByTrip(tx, 'outbound', outbound.id, new Date())
  );

  await resolveSalvage(field!.id, defenderUserId, defenderStationId);

  assert.equal(
    (await getDb().select().from(debrisFields).where(eq(debrisFields.id, field!.id))).length,
    0
  );
});

test('a salvager whose debris is gone on arrival returns empty', async () => {
  await resolveAttack();
  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'collector',
    amount: 1,
  });
  const { started, outbound } = await launchSalvage(field!.id);
  await getDb()
    .update(salvageMissions)
    .set({ debrisFieldId: null })
    .where(eq(salvageMissions.id, started.id));
  await getDb().delete(debrisFields).where(eq(debrisFields.id, field!.id));

  assert.equal((await settleTripArrival(outbound)).settled, true);
  const [mission] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, started.id));
  assert.equal(mission!.status, 'returning');
  assert.deepEqual(mission!.cargo, {});
});

test('an emptied debris field is hidden and cannot be salvaged', async () => {
  await resolveAttack();
  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  assert.ok(await getDebrisById(field!.id, attackerUserId));
  await getDb()
    .update(debrisFields)
    .set({ resources: { carbon: 0, titanium: 0, hydrogenium: 0 } })
    .where(eq(debrisFields.id, field!.id));
  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'collector',
    amount: 1,
  });

  assert.equal(await getDebrisById(field!.id, attackerUserId), null);
  await assert.rejects(launchSalvage(field!.id), /debris field not found/i);
});

test('Signature Analysis reveals an incoming fleet before it arrives', async () => {
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3 },
  });
  const incoming = async () =>
    (await getUserCombatReports(defenderUserId)).find(
      (combatReport) => combatReport.id === started.id
    )?.attackerFleet;

  assert.equal(await incoming(), null);
  await grantResearch(defenderUserId, { signature_analysis: 1 });
  assert.deepEqual(await incoming(), { merlin: 3 });
});

test('an attack cancelled without a battle keeps its fleet hidden from the defender', async () => {
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3 },
  });
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  // Destroying the attacker's home mid-flight resolves the mission without a battle.
  await getDb().transaction((tx) =>
    resolveCombatMissionByTrip(tx, 'outbound', mission!.outboundTripId, new Date())
  );
  const report = async (userId: string) =>
    (await getUserCombatReports(userId)).find((combatReport) => combatReport.id === started.id);

  const seen = await report(defenderUserId);
  assert.ok(seen);
  assert.equal(seen.attackerFleet, null);
  assert.equal(seen.attackerAmount, null);
  assert.deepEqual((await report(attackerUserId))?.attackerFleet, { merlin: 3 });
});

test('Fleet Coordination raises the hangar crew capacity', async () => {
  await grantResearch(defenderUserId, { fleet_coordination: 2 });
  assert.deepEqual(await getStationHangar(defenderStationId), { capacity: 22, used: 6 });
});

test('Cargo Compression lets a salvager carry more debris', async () => {
  const [field] = await getDb()
    .insert(debrisFields)
    .values({ sectorId, x: 2, y: 0, chunkX: 0, chunkY: 0, resources: { carbon: 400 } })
    .returning();
  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'collector',
    amount: 1,
  });
  await setTestResources(attackerStationId, { carbon: 0 });
  await grantResearch(attackerUserId, { cargo_compression: 4 });

  await resolveSalvage(field!.id);
  // Collector cargo 250 × 1.2.
  assert.equal(await getCarbon(attackerStationId), 300);
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
      fleet: { merlin: 1 },
      now,
    }),
    /protected from attacks/
  );

  await deleteTestData({ userIds: [young.id] });
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
    fleet: { merlin: 3 },
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
  assert.equal((await settleTripArrival(outbound!)).settled, true);

  const report = (await getUserCombatReports(attackerUserId)).find((r) => r.id === started.id);
  assert.equal(report?.winner, 'attacker');

  await deleteTestData({ userIds: [oldUser.id] });
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
      fleet: { merlin: 1 },
      now,
    }),
    /protected from attacks/
  );

  // Young defender launches their first attack (against the old station)
  await startAttack({
    userId: youngDefender.id,
    stationId: youngStation.id,
    targetStationId: oldStation.id,
    fleet: { javelin: 1 },
    now,
  });

  // After youngDefender's first attack, protection is broken → now attackable
  await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: youngStation.id,
    fleet: { merlin: 1 },
    now,
  });

  await deleteTestData({ userIds: [youngDefender.id, oldDefender.id] });
});

/** Sends the three Merlins and lets them arrive; the fight resolves on arrival. */
async function arriveWithAttack() {
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3 },
  });
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  assert.equal((await settleTripArrival(outbound!)).settled, true);
  return started;
}

async function report(id: string) {
  return (await getUserCombatReports(attackerUserId)).find(
    (combatReport) => combatReport.id === id
  )!;
}

async function resolveAttack() {
  const started = await arriveWithAttack();

  const [returning] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, started.id));
  const [returnTrip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, returning!.returnTripId!));
  assert.equal((await settleTripArrival(returnTrip!)).settled, true);

  return report(started.id);
}

async function resolveSalvage(
  debrisFieldId: string,
  userId = attackerUserId,
  stationId = attackerStationId
): Promise<void> {
  const { started, outbound } = await launchSalvage(debrisFieldId, userId, stationId);
  assert.equal((await settleTripArrival(outbound)).settled, true);

  const [returning] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, started.id));
  const [returnTrip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, returning!.returnTripId!));
  assert.equal((await settleTripArrival(returnTrip!)).settled, true);
}

async function launchSalvage(
  debrisFieldId: string,
  userId = attackerUserId,
  stationId = attackerStationId
) {
  const started = await startSalvage({
    userId,
    stationId,
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
  return { started, outbound: outbound! };
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
