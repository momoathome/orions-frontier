import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { worldMissions } from '../../src/lib/db/schema/world-missions.js';
import { getUserCombatReports, startAttack } from '../../src/services/combat/combat.js';
import { getRanking } from '../../src/services/ranking/ranking.js';
import { createStation, getUserStations } from '../../src/services/station/station.js';
import { runWorldTick } from '../../src/services/simulation/simulation.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
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
    createTestStation({ userId: attacker.id, sectorId, name: 'Attacker' }),
    createTestStation({ userId: defender.id, sectorId, name: 'Defender', x: 1 }),
  ]);
  attackerStationId = attackerStation.id;
  defenderStationId = defenderStation.id;
  await getDb()
    .insert(stationSpacecrafts)
    .values([
      { stationId: attackerStationId, spacecraftKey: 'merlin', amount: 6 },
      { stationId: attackerStationId, spacecraftKey: 'hammer', amount: 2 },
    ]);
});

afterEach(async () => {
  await deleteTestData({ userIds: [attackerUserId, defenderUserId], sectorIds: [sectorId] });
});

after(closeDb);

test('a mixed fleet travels at bomber speed, hides its composition and damages integrity', async () => {
  const started = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3, hammer: 1 },
  });
  const outbound = await outboundTrip(started.id);
  const [hammerRow] = await getDb()
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, attackerStationId),
        eq(stationSpacecrafts.spacecraftKey, 'hammer')
      )
    );
  assert.equal(outbound.stationSpacecraftId, hammerRow!.id);
  assert.equal(outbound.groupSize, 4);

  const incoming = (await getUserCombatReports(defenderUserId)).find((r) => r.id === started.id);
  assert.equal(incoming?.status, 'traveling');
  assert.equal(incoming.attackerFleet, null);
  assert.equal(incoming.attackerAmount, null);
  assert.equal(incoming.arrivesAt, outbound.arrivesAt.toISOString());

  assert.equal((await settleTripArrival(outbound)).settled, true);
  const report = (await getUserCombatReports(attackerUserId)).find((r) => r.id === started.id);
  assert.equal(report?.winner, 'attacker');
  assert.equal(report.integrityDamage, 20);
  assert.equal(report.defenderIntegrity, 80);
  assert.equal(report.stationDestroyed, false);
});

test('two concurrent waves destroy a weak station exactly once and relocate its ships', async () => {
  const db = getDb();
  const refuge = await createTestStation({
    userId: defenderUserId,
    sectorId,
    name: 'Refuge',
    x: 500,
  });
  await db
    .update(stations)
    .set({ integrity: 20, integrityUpdatedAt: new Date() })
    .where(eq(stations.id, defenderStationId));
  // One defender mole is away on a trip when the station falls.
  const [mole] = await db
    .update(stationSpacecrafts)
    .set({ amount: 3, lockedAmount: 1 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, defenderStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    )
    .returning();
  const now = new Date();
  await db.insert(spacecraftTrips).values({
    stationSpacecraftId: mole!.id,
    groupSize: 1,
    fromType: 'station',
    fromId: defenderStationId,
    fromX: 1,
    fromY: 0,
    toType: 'asteroid',
    toId: randomUUID(),
    toX: 1_000,
    toY: 0,
    departedAt: now,
    arrivesAt: new Date(now.getTime() + 3_600_000),
    purpose: 'mine',
  });

  const waves = await Promise.all(
    [1, 2].map(() =>
      startAttack({
        userId: attackerUserId,
        stationId: attackerStationId,
        targetStationId: defenderStationId,
        fleet: { merlin: 3, hammer: 1 },
      })
    )
  );
  const trips = await Promise.all(waves.map((wave) => outboundTrip(wave.id)));
  await Promise.all(trips.map((trip) => settleTripArrival(trip)));

  const reports = (await getUserCombatReports(attackerUserId)).filter((r) =>
    waves.some((wave) => wave.id === r.id)
  );
  assert.equal(reports.filter((r) => r.stationDestroyed).length, 1);
  assert.equal(reports.filter((r) => r.winner === null).length, 1);
  assert.equal(
    (await db.select().from(debrisFields).where(eq(debrisFields.sectorId, sectorId))).length,
    1
  );

  assert.deepEqual(
    (await getUserStations(defenderUserId)).map((station) => station.id),
    [refuge.id]
  );
  assert.equal((await getRanking(defenderUserId, 1)).me?.stationCount, 1);
  await assert.rejects(
    startAttack({
      userId: attackerUserId,
      stationId: attackerStationId,
      targetStationId: defenderStationId,
      fleet: { merlin: 1 },
    }),
    /invalid attack target/i
  );

  const [relocation] = await db
    .select()
    .from(spacecraftTrips)
    .where(and(eq(spacecraftTrips.toId, refuge.id), eq(spacecraftTrips.purpose, 'relocate')));
  assert.equal(relocation?.groupSize, 1);
  assert.equal((await settleTripArrival(relocation)).settled, true);
  const [refugeMoles] = await db
    .select({ amount: stationSpacecrafts.amount, lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(
      and(eq(stationSpacecrafts.stationId, refuge.id), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );
  assert.equal(refugeMoles?.lockedAmount, 0);
});

test('a moving world mission re-homes to the nearest surviving station', async () => {
  const db = getDb();
  const refuge = await createTestStation({
    userId: defenderUserId,
    sectorId,
    name: 'Refuge',
    x: 500,
  });
  await db
    .update(stations)
    .set({ integrity: 20, integrityUpdatedAt: new Date() })
    .where(eq(stations.id, defenderStationId));
  const [mole] = await db
    .update(stationSpacecrafts)
    .set({ amount: 3, lockedAmount: 1 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, defenderStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    )
    .returning();
  const now = new Date();
  const [mission] = await db
    .insert(worldMissions)
    .values({
      userId: defenderUserId,
      originStationId: defenderStationId,
      stationSpacecraftId: mole!.id,
      spacecraftKey: 'mole',
      missionType: 'expedition',
      targetSectorX: 900,
      targetSectorY: 900,
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 3_600_000),
    })
    .returning();

  const wave = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3, hammer: 1 },
  });
  await settleTripArrival(await outboundTrip(wave.id));

  const [moved] = await db.select().from(worldMissions).where(eq(worldMissions.id, mission!.id));
  assert.equal(moved?.status, 'traveling');
  assert.equal(moved.originStationId, refuge.id);
  const [home] = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, moved.stationSpacecraftId));
  assert.equal(home?.stationId, refuge.id);
  assert.equal(home.lockedAmount, 1);
});

test('a colony due before the attack that destroys the last station is founded in one tick', async () => {
  const db = getDb();
  await db
    .update(stations)
    .set({ integrity: 20, integrityUpdatedAt: new Date() })
    .where(eq(stations.id, defenderStationId));
  const [mole] = await db
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 1 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, defenderStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    )
    .returning();
  const [sector] = await db.select().from(sectors).where(eq(sectors.id, sectorId));
  const wave = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    fleet: { merlin: 3, hammer: 1 },
  });
  const outbound = await outboundTrip(wave.id);
  const [colonization] = await db
    .insert(worldMissions)
    .values({
      userId: defenderUserId,
      originStationId: defenderStationId,
      stationSpacecraftId: mole!.id,
      spacecraftKey: 'mole',
      missionType: 'colonization',
      targetSectorX: sector!.sectorX,
      targetSectorY: sector!.sectorY,
      targetX: 3_000,
      targetY: 0,
      colonyName: 'Lifeboat',
      departedAt: new Date(outbound.arrivesAt.getTime() - 60_000),
      arrivesAt: new Date(outbound.arrivesAt.getTime() - 1_000),
    })
    .returning();

  // Both are due in the same tick; the colony landed first, so it is not cancelled.
  await runWorldTick(new Date(outbound.arrivesAt.getTime() + 1));

  const [mission] = await db
    .select()
    .from(worldMissions)
    .where(eq(worldMissions.id, colonization!.id));
  assert.equal(mission?.status, 'arrived');
  const alive = await getUserStations(defenderUserId);
  assert.deepEqual(
    alive.map((station) => station.name),
    ['Lifeboat']
  );
});

test('a player who lost every station restarts with fresh attack protection', async () => {
  const db = getDb();
  await db
    .update(stations)
    .set({ destroyedAt: new Date(), integrity: 0 })
    .where(eq(stations.id, defenderStationId));
  await db.insert(spawnSlots).values({ sectorId, slotIndex: 1, x: 2_000, y: 0 });

  const restart = await createStation(defenderUserId, { name: 'Second Life', sectorId });
  assert.equal(restart.integrity, 100);
  const [defender] = await db.select().from(users).where(eq(users.id, defenderUserId));
  assert.ok(defender?.protectedUntil && defender.protectedUntil.getTime() > Date.now());
  await assert.rejects(createStation(defenderUserId, { name: 'Third', sectorId }), /already has/);
});

async function outboundTrip(missionId: string) {
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, missionId));
  const [trip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, mission!.outboundTripId));
  return trip!;
}
