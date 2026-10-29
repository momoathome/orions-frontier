import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateScannerRange } from '@orions-frontier/game-config';
import {
  isPointVisible,
  visibleChunkBounds,
  type ScannerCoverage,
} from '../../src/services/scanner-visibility.service.js';
import { interpolateWorldPosition } from '../../src/lib/travel.js';

const coverage = (overrides: Partial<ScannerCoverage> = {}): ScannerCoverage => ({
  stationId: 'station',
  x: 0,
  y: 0,
  range: 2_000,
  ...overrides,
});

test('scanner range uses the configured linear station progression', () => {
  assert.equal(calculateScannerRange(0), 0);
  assert.equal(calculateScannerRange(1), 1_000);
  assert.equal(calculateScannerRange(15), 8_000);
});

test('scanner visibility is circular, includes its boundary, and unions stations', () => {
  const coverages = [coverage(), coverage({ stationId: 'remote', x: -5_000, y: -5_000 })];

  assert.equal(isPointVisible(coverages, { x: 1_200, y: 1_600 }), true);
  assert.equal(isPointVisible(coverages, { x: 2_000, y: 2_000 }), false);
  assert.equal(isPointVisible(coverages, { x: -5_100, y: -5_100 }), true);
});

test('scanner chunk bounds intersect the requested range with negative coordinates', () => {
  assert.deepEqual(
    visibleChunkBounds(
      [coverage({ x: -1_500, y: -500, range: 1_000 })],
      { minChunkX: -2, maxChunkX: 2, minChunkY: -1, maxChunkY: 1 },
      1_000
    ),
    [{ minChunkX: -2, maxChunkX: -1, minChunkY: -1, maxChunkY: 0 }]
  );
});

test('world movement interpolation exposes position and velocity without route state', () => {
  const departedAt = new Date('2026-01-01T00:00:00Z');
  const arrivesAt = new Date('2026-01-01T00:00:10Z');
  const path = { fromX: 0, fromY: 10, toX: 100, toY: -10, departedAt, arrivesAt };

  assert.deepEqual(interpolateWorldPosition(path, new Date('2025-12-31T23:59:59Z')), {
    x: 0,
    y: 10,
    velocityX: 0,
    velocityY: 0,
  });
  assert.deepEqual(interpolateWorldPosition(path, new Date('2026-01-01T00:00:05Z')), {
    x: 50,
    y: 0,
    velocityX: 10,
    velocityY: -2,
  });
  assert.deepEqual(interpolateWorldPosition(path, arrivesAt), {
    x: 100,
    y: -10,
    velocityX: 0,
    velocityY: 0,
  });
});
