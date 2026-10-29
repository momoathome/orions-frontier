import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
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
import type { WorldTickResult } from '../../src/services/simulation.service.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';

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
  const db = getDb();
  await db.delete(botControllers).where(eq(botControllers.userId, userId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
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

  await db
    .update(stationResources)
    .set({ amount: -1 })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  await rejectsWith(auditor.auditTick(tick()), 'negative_resource');
  await db
    .update(stationResources)
    .set({ amount: 250 })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );

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
    .set({ upgradeEndsAt: now })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    );
  await rejectsWith(auditor.auditTick(tick()), 'overdue_active_work');
  await db
    .update(stationBuildings)
    .set({ upgradeEndsAt: null })
    .where(eq(stationBuildings.stationId, stationId));
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
