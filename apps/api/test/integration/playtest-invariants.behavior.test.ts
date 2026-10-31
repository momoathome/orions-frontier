import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { PlaytestAliasRegistry } from '../../src/tools/playtest/aliases.js';
import {
  PlaytestInvariantAuditor,
  PlaytestInvariantError,
  type PlaytestInvariantCode,
} from '../../src/tools/playtest/invariants.js';
import type { PlaytestPopulationMember } from '../../src/tools/playtest/population.js';
import type { WorldTickResult } from '../../src/services/simulation/simulation.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  setTestResources,
} from '../helpers/fixtures.js';

let userId = '';
let stationId = '';
let sectorId = '';
const now = new Date('2056-01-01T00:00:00.000Z');

before(async () => {
  await runMigrations();
  await initDb();
  const sector = await createTestSector();
  const user = await createTestUser();
  const station = await createTestStation({ userId: user.id, sectorId: sector.id });
  userId = user.id;
  stationId = station.id;
  sectorId = sector.id;
  await getDb()
    .insert(botControllers)
    .values({
      userId,
      strategy: 'goal_v1',
      strategyVersion: '1',
      profile: 'industrialist',
      nextDecisionAt: new Date('2100-01-01T00:00:00.000Z'),
    });
});

after(async () => {
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
  await closeDb();
});

function aliases(): PlaytestAliasRegistry {
  const member: PlaytestPopulationMember = {
    alias: 'player-001',
    userId,
    initialStationId: stationId,
    profile: 'industrialist',
    joinedAt: now,
    populationKind: 'synthetic_player',
  };
  return new PlaytestAliasRegistry([member]);
}

function tick(overrides: Partial<WorldTickResult> = {}): WorldTickResult {
  return {
    now,
    passes: 0,
    phases: [],
    events: [],
    botDecisions: [],
    ...overrides,
  };
}

async function rejectsWith(
  promise: Promise<void>,
  expectedCode: PlaytestInvariantCode
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PlaytestInvariantError);
    assert.ok(error.findings.some((finding) => finding.code === expectedCode));
    assert.ok(error.findings.every((finding) => !JSON.stringify(finding).includes(userId)));
    return true;
  });
}

test('auditor aborts on a negative resource, invalid fleet lock and overdue work', async () => {
  const db = getDb();
  const auditor = new PlaytestInvariantAuditor(aliases());
  await auditor.auditTick(tick());

  await setTestResources(stationId, { carbon: -1 });
  await rejectsWith(auditor.auditTick(tick()), 'negative_resource');
  await setTestResources(stationId, { carbon: 250 });

  await db
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 2 })
    .where(eq(stationSpacecrafts.stationId, stationId));
  await rejectsWith(auditor.auditTick(tick()), 'invalid_fleet_lock');
  await db
    .update(stationSpacecrafts)
    .set({ lockedAmount: 0 })
    .where(eq(stationSpacecrafts.stationId, stationId));

  await db
    .update(stationBuildings)
    .set({ upgradeEndsAt: now, upgradePaidCost: [] })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    );
  await rejectsWith(auditor.auditTick(tick()), 'overdue_active_work');
  await db
    .update(stationBuildings)
    .set({ upgradeEndsAt: null })
    .where(eq(stationBuildings.stationId, stationId));
});

test('auditor aborts on overfull storage, a negative build order and work without a fleet', async () => {
  const db = getDb();
  const auditor = new PlaytestInvariantAuditor(aliases());
  await auditor.auditTick(tick());

  await setTestResources(stationId, { carbon: 1_000_000_000 });
  await rejectsWith(auditor.auditTick(tick()), 'storage_capacity_exceeded');
  await setTestResources(stationId, { carbon: 250 });

  const [order] = await db
    .insert(spacecraftBuildOrders)
    .values({
      stationId,
      spacecraftKey: 'miner',
      amount: -1,
      orderedAmount: 1,
      unitCost: [],
      nextAt: new Date(now.getTime() + 60_000),
      endsAt: new Date(now.getTime() + 60_000),
    })
    .returning();
  await rejectsWith(auditor.auditTick(tick()), 'negative_build_order');
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.id, order!.id));

  const [fleet] = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId))
    .limit(1);
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: fleet!.id,
      groupSize: 1,
      fromType: 'station',
      fromId: stationId,
      toType: 'asteroid',
      toId: randomUUID(),
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 60_000),
      purpose: 'mine',
    })
    .returning();
  await db
    .update(stationSpacecrafts)
    .set({ amount: 0, lockedAmount: 0 })
    .where(eq(stationSpacecrafts.id, fleet!.id));
  try {
    await rejectsWith(auditor.auditTick(tick()), 'active_work_without_fleet');
  } finally {
    await db.delete(spacecraftTrips).where(eq(spacecraftTrips.id, trip!.id));
    await db
      .update(stationSpacecrafts)
      .set({ amount: fleet!.amount, lockedAmount: fleet!.lockedAmount })
      .where(eq(stationSpacecrafts.id, fleet!.id));
  }
});

test('auditor rejects duplicate completions, repeated successful actions and missing visibility proof', async () => {
  const auditor = new PlaytestInvariantAuditor(aliases());
  const event = {
    type: 'mining_delivery_completed' as const,
    eventId: 'mining-delivery:one',
    occurredAt: now,
    userId,
    stationId,
    tripId: 'trip-one',
    asteroidId: 'asteroid-one',
    requested: { carbon: 1 },
    credited: { carbon: 1 },
    discarded: {},
    targetVisibilityVerified: false,
    asteroidExhausted: false,
  };
  const decision = {
    botUserId: userId,
    decidedAt: now,
    strategy: 'goal_v1',
    profile: 'industrialist' as const,
    activeGoalBefore: null,
    activeGoalAfter: 'increase_income',
    activeGoalTargetBefore: null,
    activeGoalTargetAfter: null,
    conflictOpportunity: null,
    completedGoalType: null,
    action: 'assign_miner',
    resultKind: 'success' as const,
    reason: 'Assigned miner',
    normalizedReason: 'Assigned miner',
    hasProgress: true,
  };
  const audited = auditor.auditTick(
    tick({ events: [event, event], botDecisions: [decision, decision] })
  );
  await assert.rejects(audited, (error: unknown) => {
    assert.ok(error instanceof PlaytestInvariantError);
    const codes = error.findings.map((finding) => finding.code);
    assert.ok(codes.includes('duplicate_completion_event'));
    assert.ok(codes.includes('multiple_successful_bot_actions'));
    assert.ok(codes.includes('unverified_visible_target'));
    return true;
  });
});

test('auditor detects a station owner mutation without exposing either database id', async () => {
  const db = getDb();
  const auditor = new PlaytestInvariantAuditor(aliases());
  await auditor.auditTick(tick());
  const other = await createTestUser();
  try {
    await db.update(stations).set({ userId: other.id }).where(eq(stations.id, stationId));
    await rejectsWith(auditor.auditTick(tick()), 'station_owner_changed');
  } finally {
    await db.update(stations).set({ userId }).where(eq(stations.id, stationId));
    await db.delete(users).where(eq(users.id, other.id));
  }
});
