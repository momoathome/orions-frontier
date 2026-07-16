import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../src/lib/db/index.js';
import { runMigrations } from '../src/lib/db/migrate.js';
import { spacecraftDefinitions } from '../src/lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../src/lib/db/schema/spacecraft-trips.js';
import { stationResources } from '../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../src/lib/db/schema/stations.js';
import { users } from '../src/lib/db/schema/users.js';
import {
  reconcilePendingTrips,
  settleTripArrival,
} from '../src/services/transport/trip-arrivals.service.js';

let userId: string;
let stationId: string;
let definitionId: string;
let stationSpacecraftId: string;
const tripIds: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  const suffix = randomUUID();

  [{ id: userId }] = await db
    .insert(users)
    .values({
      username: `phase1-${suffix}`,
      email: `phase1-${suffix}@example.test`,
      passwordHash: 'not-used',
    })
    .returning({ id: users.id });
  [{ id: stationId }] = await db
    .insert(stations)
    .values({ userId, name: 'Phase 1', x: 0, y: 0 })
    .returning({ id: stations.id });
  [{ id: definitionId }] = await db
    .insert(spacecraftDefinitions)
    .values({ key: `phase1-${suffix}`, name: 'Phase 1', role: 'transport', cargo: 100 })
    .returning({ id: spacecraftDefinitions.id });
  [{ id: stationSpacecraftId }] = await db
    .insert(stationSpacecrafts)
    .values({ stationId, spacecraftDefinitionId: definitionId, amount: 2, lockedAmount: 2 })
    .returning({ id: stationSpacecrafts.id });
});

after(async () => {
  const db = getDb();
  if (tripIds.length) {
    await db.delete(spacecraftTrips).where(inArray(spacecraftTrips.id, tripIds));
  }
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.id, stationSpacecraftId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(spacecraftDefinitions).where(eq(spacecraftDefinitions.id, definitionId));
  await db.delete(users).where(eq(users.id, userId));
  await closeDb();
});

test('a trip arrival is applied exactly once when two processors race', async () => {
  const db = getDb();
  const now = new Date();
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: randomUUID(),
      toType: 'station',
      toId: stationId,
      departedAt: new Date(now.getTime() - 2_000),
      arrivesAt: new Date(now.getTime() - 1_000),
      purpose: 'return',
      cargoManifest: { phase_one: 10 },
    })
    .returning();
  assert.ok(trip);
  tripIds.push(trip.id);

  const results = await Promise.all([settleTripArrival(trip), settleTripArrival(trip)]);
  assert.deepEqual(results.sort(), [false, true]);

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));

  assert.equal(resource?.amount, 10);
  assert.equal(fleet?.lockedAmount, 1);
});

test('startup reconciliation finds a trip created before restart', async () => {
  const db = getDb();
  const now = new Date();
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId,
      groupSize: 1,
      fromType: 'station',
      fromId: stationId,
      toType: 'station',
      toId: randomUUID(),
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 60_000),
      purpose: 'combat',
    })
    .returning();
  assert.ok(trip);
  tripIds.push(trip.id);

  const scheduled = new Map<string, Date>();
  await reconcilePendingTrips(async (tripId, arrivesAt) => {
    scheduled.set(tripId, arrivesAt);
  });

  assert.equal(scheduled.get(trip.id)?.getTime(), trip.arrivesAt.getTime());
});
