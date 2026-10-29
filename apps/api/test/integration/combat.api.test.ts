import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
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
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
let attackerUserId = '';
let defenderUserId = '';
let attackerStationId = '';
let defenderStationId = '';
let sectorId = '';
let headers: ReturnType<typeof authHeaders>;

before(async () => {
  await runMigrations();
  await initDb();
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
  headers = authHeaders(app, attacker.id);
  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStation.id,
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

after(async () => {
  const db = getDb();
  const stationIds = [attackerStationId, defenderStationId];
  const fleets = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.stationId, stationIds));
  await db.delete(salvageMissions).where(inArray(salvageMissions.stationId, stationIds));
  await db.delete(combatMissions).where(inArray(combatMissions.attackerStationId, stationIds));
  for (const fleet of fleets) {
    await db.delete(spacecraftTrips).where(eq(spacecraftTrips.stationSpacecraftId, fleet.id));
  }
  await db.delete(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, [attackerUserId, defenderUserId]));
  await app.close();
  await closeDb();
});

test('combat endpoints validate, start and expose attack and salvage missions', async () => {
  const invalid = await app.inject({
    method: 'POST',
    url: `/api/stations/${attackerStationId}/attacks`,
    headers,
    payload: { targetStationId: defenderStationId, fleet: { merlin: 0 } },
  });
  assert.equal(invalid.statusCode, 400);

  const attack = await app.inject({
    method: 'POST',
    url: `/api/stations/${attackerStationId}/attacks`,
    headers,
    payload: { targetStationId: defenderStationId, fleet: { merlin: 3 } },
  });
  assert.equal(attack.statusCode, 201);
  const attackId = attack.json<{ id: string }>().id;
  await settleCombat(attackId);

  const reports = await app.inject({ method: 'GET', url: '/api/me/combats', headers });
  assert.equal(reports.statusCode, 200);
  assert.equal(reports.json()[0].status, 'resolved');
  assert.equal(reports.json()[0].winner, 'attacker');

  const [field] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.sectorId, sectorId));
  const debris = await app.inject({ method: 'GET', url: `/api/debris/${field!.id}`, headers });
  assert.equal(debris.statusCode, 200);
  assert.deepEqual(debris.json().resources, {
    carbon: 108,
    titanium: 78,
    hydrogenium: 45,
  });

  await getDb().insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftKey: 'collector',
    amount: 1,
  });
  const salvage = await app.inject({
    method: 'POST',
    url: `/api/debris/${field!.id}/salvage`,
    headers,
    payload: { stationId: attackerStationId, spacecraftKey: 'collector', amount: 1 },
  });
  assert.equal(salvage.statusCode, 201);
  await settleSalvage(salvage.json().id);

  const depleted = await app.inject({ method: 'GET', url: `/api/debris/${field!.id}`, headers });
  assert.equal(depleted.statusCode, 404);
});

async function settleCombat(missionId: string): Promise<void> {
  const [mission] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, missionId));
  await settleTrip(mission!.outboundTripId);
  const [returning] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, missionId));
  await settleTrip(returning!.returnTripId!);
}

async function settleSalvage(missionId: string): Promise<void> {
  const [mission] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, missionId));
  await settleTrip(mission!.outboundTripId);
  const [returning] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, missionId));
  await settleTrip(returning!.returnTripId!);
}

async function settleTrip(tripId: string): Promise<void> {
  const [trip] = await getDb().select().from(spacecraftTrips).where(eq(spacecraftTrips.id, tripId));
  assert.equal(await settleTripArrival(trip!), true);
}
