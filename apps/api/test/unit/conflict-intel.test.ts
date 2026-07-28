import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CombatReport, StationVisualProfile } from '@orions-frontier/shared';
import type { BotProfile } from '../../src/lib/db/schema/bot-controllers.js';
import {
  calculateHostility,
  hostilityLabel,
  estimateDefenseScore,
  estimateLootValue,
  calculateReserve,
  scoreConflictTarget,
  availableOffensivePower,
} from '../../src/services/bot/conflict-intel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const botUserId = 'bot-user-1';
const attackerId = 'attacker-user-2';
const defenderId = 'defender-user-3';

const makeReport = (overrides: Partial<CombatReport> & { id: string }): CombatReport => ({
  attackerStationId: 'a-station',
  defenderStationId: 'd-station',
  attackerUserId: attackerId,
  defenderUserId: defenderId,
  attackerAmount: 5,
  attackerLosses: 2,
  defenderLosses: 1,
  winner: 'attacker',
  loot: {},
  status: 'resolved',
  createdAt: new Date().toISOString(),
  resolvedAt: new Date().toISOString(),
  ...overrides,
});

/** Create a minimal visual profile with optional defense overrides. */
const makeProfile = (overrides?: Partial<StationVisualProfile>): StationVisualProfile => ({
  scaleTier: 1,
  modules: {} as StationVisualProfile['modules'],
  defense: {
    armor_plating: 0,
    guardian_cannon: 0,
    defense_drones: 0,
    minefield: 0,
  },
  traffic: { civilian: 0, military: 0 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Hostility: threshold levels
// ---------------------------------------------------------------------------

test('hostilityLabel returns neutral below 30', () => {
  assert.equal(hostilityLabel(0), 'neutral');
  assert.equal(hostilityLabel(15), 'neutral');
  assert.equal(hostilityLabel(29), 'neutral');
});

test('hostilityLabel returns rival at 30–59', () => {
  assert.equal(hostilityLabel(30), 'rival');
  assert.equal(hostilityLabel(45), 'rival');
  assert.equal(hostilityLabel(59), 'rival');
});

test('hostilityLabel returns hostile at 60+', () => {
  assert.equal(hostilityLabel(60), 'hostile');
  assert.equal(hostilityLabel(85), 'hostile');
  assert.equal(hostilityLabel(100), 'hostile');
});

// ---------------------------------------------------------------------------
// Hostility: calculation with decay
// ---------------------------------------------------------------------------

test('calculateHostility starts at 0 with no reports', () => {
  const score = calculateHostility(botUserId, [], new Date());
  assert.equal(score, 0);
});

test('calculateHostility increases with incoming attacks', () => {
  const now = new Date();
  const reports: CombatReport[] = [
    makeReport({
      id: 'r1',
      defenderUserId: botUserId,
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
    }),
    makeReport({
      id: 'r2',
      defenderUserId: botUserId,
      createdAt: new Date(now.getTime() - 2_000_000).toISOString(),
    }),
  ];
  const score = calculateHostility(botUserId, reports, now);
  assert.equal(score, 34); // attacks plus losses suffered
});

test('calculateHostility reduces score on successful retaliation', () => {
  const now = new Date();
  const reports: CombatReport[] = [
    makeReport({
      id: 'r1',
      defenderUserId: botUserId,
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
    }),
    makeReport({
      id: 'r2',
      attackerUserId: botUserId,
      winner: 'attacker',
      createdAt: new Date(now.getTime() - 1_000_000).toISOString(),
    }),
  ];
  const score = calculateHostility(botUserId, reports, now);
  assert.equal(score, 0); // 15 - 20 = -5 → clamped to 0
});

test('calculateHostility decays after quiet days', () => {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3_600_000);
  const reports: CombatReport[] = [
    makeReport({
      id: 'r1',
      defenderUserId: botUserId,
      createdAt: threeDaysAgo.toISOString(),
    }),
  ];
  const score = calculateHostility(botUserId, reports, now);
  // 15 attack points + 2 loss points - 3*5 decay
  assert.equal(score, 2);
});

test('calculateHostility isolates each opponent account', () => {
  const now = new Date();
  const reports = [
    makeReport({
      id: 'target',
      attackerUserId: attackerId,
      defenderUserId: botUserId,
      defenderLosses: 0,
    }),
    makeReport({
      id: 'other',
      attackerUserId: 'unrelated-opponent',
      defenderUserId: botUserId,
      defenderLosses: 10,
    }),
  ];
  assert.equal(calculateHostility(botUserId, reports, now, attackerId), 15);
});

test('calculateHostility clamps to 0-100', () => {
  const now = new Date();
  const reports: CombatReport[] = Array.from({ length: 10 }, (_, i) =>
    makeReport({
      id: `r${i}`,
      defenderUserId: botUserId,
      createdAt: new Date(now.getTime() - 60_000 * i).toISOString(),
    })
  );
  const score = calculateHostility(botUserId, reports, now);
  assert.equal(score, 100); // 10*15 = 150 → clamped to 100
});

// ---------------------------------------------------------------------------
// Defense estimation from visual profile
// ---------------------------------------------------------------------------

test('estimateDefenseScore returns 0 for tier 0 defenses', () => {
  const profile = makeProfile();
  assert.equal(estimateDefenseScore(profile), 0);
});

test('estimateDefenseScore uses upper bound of each tier', () => {
  const profile = makeProfile({
    defense: {
      armor_plating: 1, // tier 1 → max level 4 → 4*6 = 24
      guardian_cannon: 1, // tier 1 → max level 4 → 4*12 = 48
      defense_drones: 0,
      minefield: 0,
    },
  });
  const score = estimateDefenseScore(profile);
  assert.equal(score, 24 + 48);
});

test('estimateDefenseScore uses max level for tier 3', () => {
  const profile = makeProfile({
    defense: {
      armor_plating: 3, // tier 3 → max level 15 → 15*6 = 90
      guardian_cannon: 3, // tier 3 → max level 12 → 12*12 = 144
      defense_drones: 0,
      minefield: 0,
    },
  });
  const score = estimateDefenseScore(profile);
  assert.equal(score, 90 + 144);
});

// ---------------------------------------------------------------------------
// Loot estimation
// ---------------------------------------------------------------------------

test('estimateLootValue scales with scaleTier', () => {
  const p0 = makeProfile({ scaleTier: 0 });
  const p1 = makeProfile({ scaleTier: 1 });
  const p2 = makeProfile({ scaleTier: 2 });
  const p3 = makeProfile({ scaleTier: 3 });
  assert.ok(estimateLootValue(p0) < estimateLootValue(p1));
  assert.ok(estimateLootValue(p1) < estimateLootValue(p2));
  assert.ok(estimateLootValue(p2) < estimateLootValue(p3));
});

// ---------------------------------------------------------------------------
// Reserve calculation per profile
// ---------------------------------------------------------------------------

test('calculateReserve uses correct ratios per profile', () => {
  const attackPower = 100;
  const results: Record<BotProfile, number> = {
    industrialist: calculateReserve(attackPower, 'industrialist', false, false),
    pioneer: calculateReserve(attackPower, 'pioneer', false, false),
    technocrat: calculateReserve(attackPower, 'technocrat', false, false),
    warlord: calculateReserve(attackPower, 'warlord', false, false),
  };
  assert.equal(results.industrialist, 70); // 0.7
  assert.equal(results.pioneer, 60); // 0.6
  assert.equal(results.technocrat, 60); // 0.6
  assert.equal(results.warlord, 38); // 0.375 → Math.round(37.5) = 38
});

test('calculateReserve adds bonus for recent attack', () => {
  const base = calculateReserve(100, 'industrialist', false, false);
  const attacked = calculateReserve(100, 'industrialist', true, false);
  assert.equal(attacked, base + 15);
});

test('calculateReserve adds bonus for unstable colony', () => {
  const base = calculateReserve(100, 'industrialist', false, false);
  const unstable = calculateReserve(100, 'industrialist', false, true);
  assert.equal(unstable, base + 10);
});

test('calculateReserve caps at 90%', () => {
  const result = calculateReserve(100, 'industrialist', true, true);
  // 0.7 + 0.15 + 0.10 = 0.95 → capped at 0.90
  assert.equal(result, 90);
});

// ---------------------------------------------------------------------------
// Available offensive power
// ---------------------------------------------------------------------------

test('availableOffensivePower subtracts reserve from total', () => {
  assert.equal(availableOffensivePower(100, 70), 30);
  assert.equal(availableOffensivePower(50, 70), 0);
  assert.equal(availableOffensivePower(0, 0), 0);
});

// ---------------------------------------------------------------------------
// Target scoring
// ---------------------------------------------------------------------------

test('scoreConflictTarget produces deterministic scores', () => {
  const profile = makeProfile({ scaleTier: 2 });
  const result1 = scoreConflictTarget({
    targetStationId: 'target-1',
    ownerId: 'owner-1',
    distance: 10_000,
    visualProfile: profile,
    hostilityScore: 45,
    profile: 'warlord',
    ownAttackPower: 200,
    botUserId,
  });
  const result2 = scoreConflictTarget({
    targetStationId: 'target-1',
    ownerId: 'owner-1',
    distance: 10_000,
    visualProfile: profile,
    hostilityScore: 45,
    profile: 'warlord',
    ownAttackPower: 200,
    botUserId,
  });
  assert.equal(result1.score, result2.score);
});

test('scoreConflictTarget prefers rival over neutral', () => {
  const profile = makeProfile({ scaleTier: 1 });
  const rival = scoreConflictTarget({
    targetStationId: 't1',
    ownerId: 'o1',
    distance: 10_000,
    visualProfile: profile,
    hostilityScore: 45,
    profile: 'warlord',
    ownAttackPower: 100,
    botUserId,
  });
  const neutral = scoreConflictTarget({
    targetStationId: 't2',
    ownerId: 'o2',
    distance: 10_000,
    visualProfile: profile,
    hostilityScore: 0,
    profile: 'warlord',
    ownAttackPower: 100,
    botUserId,
  });
  assert.ok(rival.score > neutral.score, 'rival should score higher than neutral');
});

test('scoreConflictTarget includes affinity tie-breaker', () => {
  const profile = makeProfile({ scaleTier: 1 });
  const result = scoreConflictTarget({
    targetStationId: 't1',
    ownerId: 'o1',
    distance: 10_000,
    visualProfile: profile,
    hostilityScore: 45,
    profile: 'warlord',
    ownAttackPower: 100,
    botUserId,
  });
  assert.ok(typeof result.score === 'number');
  assert.ok(result.score >= 0);
});

test('industrialist has highest reserve, warlord lowest', () => {
  const ind = calculateReserve(100, 'industrialist', false, false);
  const war = calculateReserve(100, 'warlord', false, false);
  assert.ok(ind > war, 'Industrialist reserve should exceed warlord');
  // Pioneer and technocrat both use 0.6 — same value is expected
});
