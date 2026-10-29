import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { and, eq, inArray, or } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids } from '../../src/lib/db/schema/asteroids.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { getUserCombatReports, startAttack } from '../../src/services/combat.service.js';
import { getRanking } from '../../src/services/ranking.service.js';
import { createStation, getUserStations } from '../../src/services/station.service.js';
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
  const db = getDb();
  const userIds = [attackerUserId, defenderUserId];
  const stationIds = (
    await db.select({ id: stations.id }).from(stations).where(inArray(stations.userId, userIds))
  ).map((station) => station.id);
  const fleetIds = (
    await db
      .select({ id: stationSpacecrafts.id })
      .from(stationSpacecrafts)
      .where(inArray(stationSpacecrafts.stationId, stationIds))
  ).map((fleet) => fleet.id);
  await db
    .delete(combatMissions)
    .where(
      or(
        inArray(combatMissions.attackerStationId, stationIds),
        inArray(combatMissions.defenderStationId, stationIds)
      )
    );
  if (fleetIds.length > 0) {
    await db.delete(spacecraftTrips).where(inArray(spacecraftTrips.stationSpacecraftId, fleetIds));
  }
  await db.delete(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db
    .update(spawnSlots)
    .set({ stationId: null })
    .where(inArray(spawnSlots.stationId, stationIds));
  await db.delete(spawnSlots).where(eq(spawnSlots.sectorId, sectorId));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(asteroids).where(eq(asteroids.sectorId, sectorId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, userIds));
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

  assert.equal(await settleTripArrival(outbound), true);
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
  assert.equal(await settleTripArrival(relocation), true);
  const [refugeMoles] = await db
    .select({ amount: stationSpacecrafts.amount, lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(
      and(eq(stationSpacecrafts.stationId, refuge.id), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );
  assert.equal(refugeMoles?.lockedAmount, 0);
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
