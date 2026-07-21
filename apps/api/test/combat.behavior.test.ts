import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../src/lib/db/index.js';
import { runMigrations } from '../src/lib/db/migrate.js';
import { asteroids } from '../src/lib/db/schema/asteroids.js';
import { combatMissions } from '../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../src/lib/db/schema/debris-fields.js';
import { stationInfluence } from '../src/lib/db/schema/station-influence.js';
import { sectors } from '../src/lib/db/schema/sectors.js';
import { spacecraftDefinitions } from '../src/lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../src/lib/db/schema/spacecraft-trips.js';
import { spawnSlots } from '../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../src/lib/db/schema/stations.js';
import { users } from '../src/lib/db/schema/users.js';
import { seedBuildingDefinitions, seedSpacecraftDefinitions } from '../src/lib/seed.js';
import { getUserCombatReports, startAttack } from '../src/services/combat.service.js';
import { startSalvage } from '../src/services/salvage.service.js';
import { getStationInfluence, takeOverStation } from '../src/services/influence.service.js';
import { ensureSector } from '../src/services/sector.service.js';
import { createStation } from '../src/services/station.service.js';
import { settleTripArrival } from '../src/services/transport/trip-arrivals.service.js';

const attackerUserId = randomUUID();
const defenderUserId = randomUUID();
let attackerStationId = '';
let defenderStationId = '';
let sectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
  await seedSpacecraftDefinitions();
  await seedBuildingDefinitions();
  const db = getDb();
  const suffix = randomUUID();
  await db.insert(users).values([
    {
      id: attackerUserId,
      username: `attacker-${suffix}`,
      email: `attacker-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
    {
      id: defenderUserId,
      username: `defender-${suffix}`,
      email: `defender-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
  ]);
  sectorId = (await db.transaction((tx) => ensureSector(tx, 200, 200, 'settlement'))).id;
  attackerStationId = (await createStation(attackerUserId, { name: 'Attacker', sectorId })).id;
  defenderStationId = (await createStation(defenderUserId, { name: 'Defender', sectorId })).id;
  const [merlin] = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.key, 'merlin'));
  await db.insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftDefinitionId: merlin!.id,
    amount: 3,
  });
});

after(async () => {
  const db = getDb();
  const stationIds = [attackerStationId, defenderStationId];
  await db.delete(salvageMissions).where(inArray(salvageMissions.stationId, stationIds));
  await db.delete(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  await db.delete(combatMissions).where(inArray(combatMissions.attackerStationId, stationIds));
  const fleets = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.stationId, stationIds));
  if (fleets.length > 0) {
    await db.delete(spacecraftTrips).where(
      inArray(
        spacecraftTrips.stationSpacecraftId,
        fleets.map((fleet) => fleet.id)
      )
    );
  }
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db
    .update(spawnSlots)
    .set({ stationId: null })
    .where(inArray(spawnSlots.stationId, stationIds));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(asteroids).where(eq(asteroids.sectorId, sectorId));
  await db.delete(spawnSlots).where(eq(spawnSlots.sectorId, sectorId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, [attackerUserId, defenderUserId]));
  await closeDb();
});

test('combat uses normal flight time, applies losses and returns bounded loot', async () => {
  const db = getDb();
  const [merlin] = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.key, 'merlin'));
  const [beforeAttackerCarbon] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(
        eq(stationResources.stationId, attackerStationId),
        eq(stationResources.resourceKey, 'carbon')
      )
    );
  const [beforeDefenderCarbon] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(
        eq(stationResources.stationId, defenderStationId),
        eq(stationResources.resourceKey, 'carbon')
      )
    );
  const mission = await startAttack({
    userId: attackerUserId,
    stationId: attackerStationId,
    targetStationId: defenderStationId,
    spacecraftDefinitionId: merlin!.id,
    amount: 3,
  });
  const [outbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      eq(
        spacecraftTrips.id,
        (await db.select().from(combatMissions).where(eq(combatMissions.id, mission.id)))[0]!
          .outboundTripId
      )
    );
  assert.equal(await settleTripArrival(outbound!), true);

  const [returnTrip] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.purpose, 'combat_return'),
        eq(spacecraftTrips.status, 'traveling'),
        eq(spacecraftTrips.toId, attackerStationId)
      )
    );
  assert.ok(returnTrip);
  assert.equal(await settleTripArrival(returnTrip), true);

  const [report] = await getUserCombatReports(attackerUserId);
  assert.equal(report?.status, 'resolved');
  assert.equal(report?.winner, 'attacker');
  assert.equal(report?.attackerLosses, 2);
  assert.equal(report?.defenderLosses, 1);
  assert.deepEqual(report?.loot, { carbon: 10 });

  const [attackerCarbon, defenderCarbon, attackerFleet] = await Promise.all([
    db
      .select({ amount: stationResources.amount })
      .from(stationResources)
      .where(
        and(
          eq(stationResources.stationId, attackerStationId),
          eq(stationResources.resourceKey, 'carbon')
        )
      )
      .then((rows) => rows[0]),
    db
      .select({ amount: stationResources.amount })
      .from(stationResources)
      .where(
        and(
          eq(stationResources.stationId, defenderStationId),
          eq(stationResources.resourceKey, 'carbon')
        )
      )
      .then((rows) => rows[0]),
    db
      .select({ amount: stationSpacecrafts.amount, lockedAmount: stationSpacecrafts.lockedAmount })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, attackerStationId),
          eq(stationSpacecrafts.spacecraftDefinitionId, merlin!.id)
        )
      )
      .then((rows) => rows[0]),
  ]);
  assert.equal(attackerCarbon?.amount, beforeAttackerCarbon!.amount + 10);
  assert.equal(defenderCarbon?.amount, beforeDefenderCarbon!.amount - 10);
  assert.deepEqual(attackerFleet, { amount: 1, lockedAmount: 0 });

  const [field] = await db.select().from(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  assert.deepEqual(field?.resources, { carbon: 96, titanium: 66, hydrogenium: 15 });

  const [collector] = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.key, 'collector'));
  await db.insert(stationSpacecrafts).values({
    stationId: attackerStationId,
    spacecraftDefinitionId: collector!.id,
    amount: 1,
  });
  const salvage = await startSalvage({
    userId: attackerUserId,
    stationId: attackerStationId,
    debrisFieldId: field!.id,
    spacecraftDefinitionId: collector!.id,
    amount: 1,
  });
  const [salvageOutbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      eq(
        spacecraftTrips.id,
        (await db.select().from(salvageMissions).where(eq(salvageMissions.id, salvage.id)))[0]!
          .outboundTripId
      )
    );
  assert.equal(await settleTripArrival(salvageOutbound!), true);
  const [salvageReturn] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(eq(spacecraftTrips.purpose, 'salvage_return'), eq(spacecraftTrips.status, 'traveling'))
    );
  assert.equal(await settleTripArrival(salvageReturn!), true);

  const [resolvedSalvage, remainingField, collectorFleet, salvagedCarbon] = await Promise.all([
    db
      .select()
      .from(salvageMissions)
      .where(eq(salvageMissions.id, salvage.id))
      .then((rows) => rows[0]),
    db
      .select()
      .from(debrisFields)
      .where(eq(debrisFields.id, field!.id))
      .then((rows) => rows[0]),
    db
      .select({ lockedAmount: stationSpacecrafts.lockedAmount })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, attackerStationId),
          eq(stationSpacecrafts.spacecraftDefinitionId, collector!.id)
        )
      )
      .then((rows) => rows[0]),
    db
      .select({ amount: stationResources.amount })
      .from(stationResources)
      .where(
        and(
          eq(stationResources.stationId, attackerStationId),
          eq(stationResources.resourceKey, 'carbon')
        )
      )
      .then((rows) => rows[0]),
  ]);
  assert.equal(resolvedSalvage?.status, 'resolved');
  assert.equal(resolvedSalvage?.debrisFieldId, null);
  assert.equal(remainingField, undefined);
  assert.equal(collectorFleet?.lockedAmount, 0);
  assert.equal(salvagedCarbon?.amount, beforeAttackerCarbon!.amount + 10 + 96);

  await db
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 1 })
    .where(eq(stationSpacecrafts.stationId, defenderStationId));
  const control = await getStationInfluence(attackerUserId, defenderStationId);
  assert.deepEqual(
    {
      points: control.points,
      defended: control.defended,
      canTakeOver: control.canTakeOver,
    },
    { points: 1, defended: false, canTakeOver: true }
  );
  await takeOverStation(attackerUserId, defenderStationId);
  const [captured] = await db
    .select({ userId: stations.userId })
    .from(stations)
    .where(eq(stations.id, defenderStationId));
  assert.equal(captured?.userId, attackerUserId);
  assert.equal(
    (
      await db
        .select()
        .from(stationInfluence)
        .where(eq(stationInfluence.stationId, defenderStationId))
    ).length,
    0
  );
});
