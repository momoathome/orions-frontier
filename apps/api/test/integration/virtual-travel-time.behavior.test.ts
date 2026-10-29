import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray, like, notExists, or } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroidAssignments,
  asteroids,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { worldMissions } from '../../src/lib/db/schema/world-missions.js';
import { createSeededExecutionContext } from '../../src/lib/game-execution-context.js';
import { startAttack } from '../../src/services/combat.service.js';
import { createAsteroidAssignment } from '../../src/services/mining/assignment.service.js';
import { startSalvage } from '../../src/services/salvage.service.js';
import {
  setTestResources,
  createTestSector,
  createTestStation,
  createTestUser,
} from '../helpers/fixtures.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.service.js';
import {
  completeDueWorldMissions,
  startColonization,
  startExpedition,
} from '../../src/services/world-mission.service.js';

const userIds: string[] = [];
const sectorIds: string[] = [];
let ownerId = '';
let ownerStationId = '';
let targetStationId = '';
let sectorX = 0;
let sectorY = 0;
let asteroidId = '';

before(async () => {
  await runMigrations();
  await initDb();

  const coordinateSuffix = Number.parseInt(randomUUID().slice(0, 6), 16) % 50_000;
  sectorX = 100_000 + coordinateSuffix;
  sectorY = -sectorX;
  const settlement = await createTestSector({
    sectorX,
    sectorY,
    role: 'settlement',
    seed: `virtual-travel-${coordinateSuffix}`,
  });
  sectorIds.push(settlement.id);
  const centerX = sectorX * 6_000;
  const centerY = sectorY * 6_000;

  const owner = await createTestUser();
  const target = await createTestUser({
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
  });
  ownerId = owner.id;
  userIds.push(owner.id, target.id);

  const ownerStation = await createTestStation({
    userId: owner.id,
    sectorId: settlement.id,
    name: 'Virtual Travel Origin',
    x: centerX,
    y: centerY,
  });
  const targetStation = await createTestStation({
    userId: target.id,
    sectorId: settlement.id,
    name: 'Virtual Combat Target',
    x: centerX + 200,
    y: centerY + 100,
  });
  ownerStationId = ownerStation.id;
  targetStationId = targetStation.id;

  await setTestResources(ownerStation.id, {
    carbon: 100_000,
    titanium: 100_000,
    hydrogenium: 100_000,
    kyber_crystal: 100_000,
    astatine: 100_000,
  });
  await getDb()
    .insert(stationSpacecrafts)
    .values([
      {
        stationId: ownerStation.id,
        spacecraftKey: 'merlin',
        amount: 1,
        lockedAmount: 0,
      },
      {
        stationId: ownerStation.id,
        spacecraftKey: 'collector',
        amount: 1,
        lockedAmount: 0,
      },
    ]);
  // One defending Mole keeps the single-Merlin attack a win, independent of the starter fleet.
  await getDb()
    .update(stationSpacecrafts)
    .set({ amount: 1 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, targetStation.id),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );

  asteroidId = randomUUID();
  await getDb()
    .insert(asteroids)
    .values({
      id: asteroidId,
      sectorId: settlement.id,
      x: centerX + 100,
      y: centerY,
      chunkX: Math.floor((centerX + 100) / 1_000),
      chunkY: Math.floor(centerY / 1_000),
      size: 'small',
    });
  // The vein is intentionally tiny so the first delivery completes the whole assignment.
  await getDb().insert(asteroidVeins).values({
    id: randomUUID(),
    asteroidId,
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 1,
  });
});

after(async () => {
  const db = getDb();
  const allStations = await db
    .select({ id: stations.id })
    .from(stations)
    .where(inArray(stations.userId, userIds));
  const allStationIds = allStations.map((station) => station.id);
  const allSectors = await db
    .select({ id: sectors.id })
    .from(sectors)
    .where(
      or(
        and(inArray(sectors.sectorX, [sectorX, sectorX + 1]), inArray(sectors.sectorY, [sectorY])),
        // The drains also settle due dev-world missions with this test's seeded IDs; an unsettled
        // leftover sector would collide with the same deterministic ID on the next run.
        and(
          like(sectors.seed, 'virtual-travel-world:%'),
          notExists(db.select().from(stations).where(eq(stations.sectorId, sectors.id)))
        )
      )
    );
  const allSectorIds = [...new Set([...sectorIds, ...allSectors.map((sector) => sector.id)])];

  await db.delete(salvageMissions).where(inArray(salvageMissions.userId, userIds));
  await db.delete(combatMissions).where(inArray(combatMissions.userId, userIds));
  await db.delete(worldMissions).where(inArray(worldMissions.userId, userIds));
  if (allStationIds.length > 0) {
    await db
      .delete(spacecraftTrips)
      .where(
        inArray(
          spacecraftTrips.stationSpacecraftId,
          db
            .select({ id: stationSpacecrafts.id })
            .from(stationSpacecrafts)
            .where(inArray(stationSpacecrafts.stationId, allStationIds))
        )
      );
    await db
      .delete(asteroidAssignments)
      .where(inArray(asteroidAssignments.stationId, allStationIds));
    await db.delete(stationResources).where(inArray(stationResources.stationId, allStationIds));
    await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, allStationIds));
    await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, allStationIds));
    await db.delete(stations).where(inArray(stations.id, allStationIds));
  }
  if (allSectorIds.length > 0) {
    await db.delete(debrisFields).where(inArray(debrisFields.sectorId, allSectorIds));
    await db.delete(asteroids).where(inArray(asteroids.sectorId, allSectorIds));
    await db.delete(sectors).where(inArray(sectors.id, allSectorIds));
  }
  await db.delete(users).where(inArray(users.id, userIds));
  await closeDb();
});

test('virtual mining uses deterministic IDs and arrival-based follow-up legs', async () => {
  const context = createSeededExecutionContext({
    now: new Date('2042-01-01T00:00:00.000Z'),
    seed: 'virtual-mining-chain',
  });
  const expected = createSeededExecutionContext({
    now: context.now,
    seed: 'virtual-mining-chain',
  });

  const assignment = await createAsteroidAssignment(
    {
      userId: ownerId,
      stationId: ownerStationId,
      asteroidId,
      spacecraftKey: 'mole',
      assignedAmount: 1,
    },
    context
  );
  assert.ok(!('code' in assignment));
  assert.equal(assignment.id, expected.nextId('assignment'));

  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.assignmentId, assignment.id));
  assert.equal(outbound?.id, expected.nextId('trip'));
  assert.equal(outbound.departedAt.toISOString(), context.now.toISOString());
  assert.equal(outbound.createdAt.toISOString(), context.now.toISOString());

  assert.equal(
    await settleTripArrival(
      outbound,
      context.at(new Date(outbound.arrivesAt.getTime() + 24 * 3_600_000))
    ),
    true
  );
  const [returnTrip] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignment.id),
        eq(spacecraftTrips.purpose, 'mining_return')
      )
    );
  assert.equal(returnTrip?.id, expected.nextId('trip'));
  assert.equal(
    returnTrip.departedAt.toISOString(),
    new Date(outbound.arrivesAt.getTime() + 6_000).toISOString()
  );
  assert.equal(returnTrip.createdAt.toISOString(), outbound.arrivesAt.toISOString());

  assert.equal(await settleTripArrival(returnTrip, context.at(returnTrip.arrivesAt)), true);
  assert.equal(
    (
      await getDb()
        .select()
        .from(asteroidAssignments)
        .where(eq(asteroidAssignments.id, assignment.id))
    ).length,
    0
  );
});

test('virtual expedition and colonization preserve mission causality', async () => {
  const expeditionContext = createSeededExecutionContext({
    now: new Date('2042-01-02T00:00:00.000Z'),
    seed: 'virtual-expedition-chain',
    worldSeed: 'virtual-travel-world',
  });
  const expectedExpedition = createSeededExecutionContext({
    now: expeditionContext.now,
    seed: 'virtual-expedition-chain',
    worldSeed: 'virtual-travel-world',
  });
  const expedition = await startExpedition(
    {
      userId: ownerId,
      stationId: ownerStationId,
      sectorX: sectorX + 1,
      sectorY,
    },
    expeditionContext
  );
  assert.equal(expedition.id, expectedExpedition.nextId('world-mission'));
  assert.equal(expedition.departedAt, expeditionContext.now.toISOString());

  await completeDueWorldMissions(
    expeditionContext.at(new Date(Date.parse(expedition.arrivesAt) + 24 * 3_600_000))
  );
  const [returning] = await getDb()
    .select()
    .from(worldMissions)
    .where(eq(worldMissions.id, expedition.id));
  assert.equal(returning?.status, 'returning');
  assert.equal(returning.departedAt.toISOString(), expedition.arrivesAt);
  await completeDueWorldMissions(expeditionContext.at(returning.arrivesAt));
  assert.equal(
    (
      await getDb()
        .select({ status: worldMissions.status })
        .from(worldMissions)
        .where(eq(worldMissions.id, expedition.id))
    )[0]?.status,
    'arrived'
  );

  const colonyContext = createSeededExecutionContext({
    now: new Date('2042-01-03T00:00:00.000Z'),
    seed: 'virtual-colony-chain',
    worldSeed: 'virtual-travel-world',
  });
  const expectedColony = createSeededExecutionContext({
    now: colonyContext.now,
    seed: 'virtual-colony-chain',
    worldSeed: 'virtual-travel-world',
  });
  const colonization = await startColonization(
    {
      userId: ownerId,
      stationId: ownerStationId,
      sectorX: sectorX + 1,
      sectorY,
      name: 'Virtual Colony',
    },
    colonyContext
  );
  assert.equal(colonization.id, expectedColony.nextId('world-mission'));
  await completeDueWorldMissions(
    colonyContext.at(new Date(Date.parse(colonization.arrivesAt) + 24 * 3_600_000))
  );

  const [colony] = await getDb()
    .select()
    .from(stations)
    .where(and(eq(stations.userId, ownerId), eq(stations.name, 'Virtual Colony')));
  assert.equal(colony?.id, expectedColony.nextId('station'));
  assert.equal(colony.createdAt.toISOString(), colonization.arrivesAt);
});

test('virtual combat and salvage complete through deterministic arrival chains', async () => {
  const combatContext = createSeededExecutionContext({
    now: new Date('2042-01-04T00:00:00.000Z'),
    seed: 'virtual-combat-chain',
  });
  const expectedCombat = createSeededExecutionContext({
    now: combatContext.now,
    seed: 'virtual-combat-chain',
  });
  const combat = await startAttack({
    userId: ownerId,
    stationId: ownerStationId,
    targetStationId,
    spacecraftKey: 'merlin',
    amount: 1,
    context: combatContext,
  });
  const expectedCombatOutboundId = expectedCombat.nextId('trip');
  assert.equal(combat.id, expectedCombat.nextId('combat-mission'));

  const [startedCombat] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, combat.id));
  const [combatOutbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, startedCombat!.outboundTripId));
  assert.equal(combatOutbound?.id, expectedCombatOutboundId);
  assert.equal(combatOutbound.departedAt.toISOString(), combatContext.now.toISOString());
  await settleTripArrival(
    combatOutbound,
    combatContext.at(new Date(combatOutbound.arrivesAt.getTime() + 24 * 3_600_000))
  );

  const [resolvedCombat] = await getDb()
    .select()
    .from(combatMissions)
    .where(eq(combatMissions.id, combat.id));
  assert.equal(resolvedCombat?.winner, 'attacker');
  assert.equal(resolvedCombat.status, 'returning');
  const expectedDebrisId = expectedCombat.nextId('debris');
  const expectedCombatReturnId = expectedCombat.nextId('trip');
  const [debris] = await getDb()
    .select()
    .from(debrisFields)
    .where(eq(debrisFields.id, expectedDebrisId));
  assert.ok(debris);
  const [combatReturn] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, resolvedCombat.returnTripId!));
  assert.equal(combatReturn?.id, expectedCombatReturnId);
  assert.equal(combatReturn.departedAt.toISOString(), combatOutbound.arrivesAt.toISOString());
  await settleTripArrival(combatReturn, combatContext.at(combatReturn.arrivesAt));

  const salvageContext = createSeededExecutionContext({
    now: new Date('2042-01-05T00:00:00.000Z'),
    seed: 'virtual-salvage-chain',
  });
  const expectedSalvage = createSeededExecutionContext({
    now: salvageContext.now,
    seed: 'virtual-salvage-chain',
  });
  const salvage = await startSalvage(
    {
      userId: ownerId,
      stationId: ownerStationId,
      debrisFieldId: debris.id,
      spacecraftKey: 'collector',
      amount: 1,
    },
    salvageContext
  );
  const expectedSalvageOutboundId = expectedSalvage.nextId('trip');
  assert.equal(salvage.id, expectedSalvage.nextId('salvage-mission'));
  const [startedSalvage] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, salvage.id));
  const [salvageOutbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, startedSalvage!.outboundTripId));
  assert.equal(salvageOutbound?.id, expectedSalvageOutboundId);
  await settleTripArrival(
    salvageOutbound,
    salvageContext.at(new Date(salvageOutbound.arrivesAt.getTime() + 24 * 3_600_000))
  );
  const [returningSalvage] = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.id, salvage.id));
  const [salvageReturn] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, returningSalvage!.returnTripId!));
  assert.equal(salvageReturn?.departedAt.toISOString(), salvageOutbound.arrivesAt.toISOString());
  await settleTripArrival(salvageReturn, salvageContext.at(salvageReturn.arrivesAt));
  assert.equal(
    (
      await getDb()
        .select({ status: salvageMissions.status })
        .from(salvageMissions)
        .where(eq(salvageMissions.id, salvage.id))
    )[0]?.status,
    'resolved'
  );
});
