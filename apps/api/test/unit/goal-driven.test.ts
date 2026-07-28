import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GoalCandidate } from '../../src/services/bot/goal-driven-v1.js';
import { scoreCandidate, selectGoal } from '../../src/services/bot/goal-driven-v1.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cand = (
  overrides: Partial<GoalCandidate> & { goalType: GoalCandidate['goalType']; targetRef: string }
): GoalCandidate => ({
  category: 'economy',
  baseNeed: 50,
  opportunity: 20,
  longTermValue: 30,
  commitment: 0,
  cost: 20,
  risk: 10,
  blockers: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// All four profile weightings produce different scores
// ---------------------------------------------------------------------------

test('each profile scores the same candidate differently', () => {
  const c = cand({ goalType: 'increase_income', targetRef: 'station:a' });

  const industrialist = scoreCandidate(c, 'industrialist');
  const pioneer = scoreCandidate(c, 'pioneer');
  const technocrat = scoreCandidate(c, 'technocrat');
  const warlord = scoreCandidate(c, 'warlord');

  // Economy weight: industrialist=1.5, pioneer=1.0, technocrat=1.0, warlord=1.0
  // So industrialist should have the highest baseNeed contribution for economy goals
  assert.ok(
    industrialist.score > warlord.score,
    'industrialist should score economy higher than warlord'
  );

  // Check that scores are distinct (different riskWeight etc.)
  const scores = new Set([industrialist.score, pioneer.score, technocrat.score, warlord.score]);
  assert.equal(scores.size, 4, 'All four profiles must produce different scores');
});

test('each profile prefers its own category', () => {
  const economyCand = cand({
    goalType: 'increase_income',
    targetRef: 'station:a',
    category: 'economy',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const researchCand = cand({
    goalType: 'research_technology',
    targetRef: 'tech:foo',
    category: 'research',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const expansionCand = cand({
    goalType: 'explore_sector',
    targetRef: 'sector:1:2',
    category: 'expansion',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const conflictCand = cand({
    goalType: 'raid',
    targetRef: 'user:b',
    category: 'conflict',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });

  const candidates = [economyCand, researchCand, expansionCand, conflictCand];

  // Industrialist → prefers economy
  let result = selectGoal(candidates, 'industrialist', null);
  assert.equal(result.selected?.goalType, 'increase_income', 'industrialist prefers economy');

  // Pioneer → prefers expansion
  result = selectGoal(candidates, 'pioneer', null);
  assert.equal(result.selected?.goalType, 'explore_sector', 'pioneer prefers expansion');

  // Technocrat → prefers research
  result = selectGoal(candidates, 'technocrat', null);
  assert.equal(result.selected?.goalType, 'research_technology', 'technocrat prefers research');

  // Warlord → prefers conflict
  result = selectGoal(candidates, 'warlord', null);
  assert.equal(result.selected?.goalType, 'raid', 'warlord prefers conflict');
});

// ---------------------------------------------------------------------------
// Hysteresis (25% threshold)
// ---------------------------------------------------------------------------

test('keeps current goal when alternative is not 25% higher', () => {
  const current = cand({ goalType: 'stabilize_station', targetRef: 'station:a', baseNeed: 50 });
  const alternative = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 58 });

  // alternative scores ~16% higher, below threshold
  const result = selectGoal([current, alternative], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:a',
  });

  assert.equal(result.selected?.goalType, 'stabilize_station');
  assert.ok(result.reason.includes('Keeping'));
});

test('switches when alternative is 25% higher', () => {
  const current = cand({ goalType: 'stabilize_station', targetRef: 'station:a', baseNeed: 50 });
  const alternative = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 90 });

  // alternative scores significantly higher, above 25% threshold
  const result = selectGoal([current, alternative], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:a',
  });

  assert.equal(result.selected?.goalType, 'increase_income');
  assert.ok(result.reason.includes('Switching'));
});

test('switches to highest when current goal is no longer a candidate', () => {
  const a = cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 60 });
  const b = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 80 });

  const result = selectGoal([a, b], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:old',
  });

  assert.equal(result.selected?.targetRef, 'station:b');
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

test('ties broken by goalType then targetRef', () => {
  const a = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 50 });
  const b = cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 50 });
  const c = cand({ goalType: 'stabilize_station', targetRef: 'station:c', baseNeed: 50 });

  const result = selectGoal([a, b, c], 'industrialist', null);

  // Same score: increase_income < stabilize_station alphabetically
  assert.equal(result.selected?.goalType, 'increase_income');

  // If we only keep increase_income ones, station:a < station:b
  const result2 = selectGoal([a, b], 'industrialist', null);
  assert.equal(result2.selected?.targetRef, 'station:a');
});

// ---------------------------------------------------------------------------
// No positive score
// ---------------------------------------------------------------------------

test('returns null when no candidate has positive score', () => {
  const bad = cand({
    goalType: 'increase_income',
    targetRef: 'station:a',
    baseNeed: 0,
    opportunity: 0,
    longTermValue: 0,
    cost: 100,
  });

  const result = selectGoal([bad], 'industrialist', null);
  assert.equal(result.selected, null);
  assert.ok(result.reason.includes('non-positive'));
});

// ---------------------------------------------------------------------------
// Empty candidates
// ---------------------------------------------------------------------------

test('returns null for empty candidate list', () => {
  const result = selectGoal([], 'industrialist', null);
  assert.equal(result.selected, null);
  assert.equal(result.scored, null);
  assert.ok(result.reason.includes('No candidates'));
});

// ---------------------------------------------------------------------------
// Determinism: identical input → identical output
// ---------------------------------------------------------------------------

test('identical input produces identical result', () => {
  const candidates = [
    cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 70 }),
    cand({
      goalType: 'research_technology',
      targetRef: 'tech:bar',
      baseNeed: 40,
      category: 'research',
    }),
    cand({
      goalType: 'explore_sector',
      targetRef: 'sector:1:2',
      baseNeed: 30,
      category: 'expansion',
    }),
  ];

  const result1 = selectGoal(candidates, 'technocrat', null);
  const result2 = selectGoal(candidates, 'technocrat', null);

  assert.deepEqual(result1, result2);
});

// ---------------------------------------------------------------------------
// Score breakdown is present in result
// ---------------------------------------------------------------------------

test('scored candidate includes breakdown', () => {
  const c = cand({ goalType: 'stabilize_station', targetRef: 'station:x' });
  const scored = scoreCandidate(c, 'pioneer');
  assert.ok('score' in scored);
  assert.ok('scoreBreakdown' in scored);
  assert.ok(typeof scored.scoreBreakdown.baseNeedWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.opportunity === 'number');
  assert.ok(typeof scored.scoreBreakdown.longTermValueWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.commitment === 'number');
  assert.ok(typeof scored.scoreBreakdown.cost === 'number');
  assert.ok(typeof scored.scoreBreakdown.riskWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.blockers === 'number');
});
