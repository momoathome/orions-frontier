import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';
import type { PlaytestBootstrapResult } from '../../src/tools/playtest/bootstrap.js';

export function assertBootstrapResult(result: PlaytestBootstrapResult): void {
  assert.equal(result.sectors, (WORLD_CONFIG.INITIAL_SECTOR_RADIUS * 2 + 1) ** 2);
  assert.ok(result.asteroids > 0);
  assert.ok(result.veins >= result.asteroids);
  assert.equal(result.spawnSlots, WORLD_CONFIG.SECTOR.STATION_CAPACITY);
  assert.ok(result.resourceUnits > 0);
  assert.equal(result.users, 0);
  assert.equal(result.stations, 0);
  assert.match(result.checksum, /^[0-9a-f]{64}$/);
}

test('playtest bootstrap result contract rejects accounts and reports the generated world', () => {
  assertBootstrapResult({
    checksum: 'a'.repeat(64),
    sectors: 9,
    asteroids: 1,
    veins: 1,
    spawnSlots: WORLD_CONFIG.SECTOR.STATION_CAPACITY,
    resourceUnits: 1,
    users: 0,
    stations: 0,
  });
});
