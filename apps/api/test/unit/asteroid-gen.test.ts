import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resources as gameResources, spacecrafts } from '@orions-frontier/game-config';
import type { ResourceKey } from '@orions-frontier/shared';
import { calculateMiningCycle } from '../../src/lib/mining-cycle.js';
import { calcDistance } from '../../src/lib/travel.js';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';
import { buildAsteroid } from '../../src/lib/world-gen/asteroid-gen.js';
import { SeededRng } from '../../src/lib/world-gen/rng.js';
import {
  generateSector,
  generateStarterPocket,
  rareResourceForSector,
} from '../../src/lib/world-gen/sector-gen.js';

const isRareResource = (resourceKey: ResourceKey): boolean =>
  gameResources[resourceKey].rarity === 'rare';

test('generates one finite resource budget distributed across all veins', () => {
  const asteroid = buildAsteroid(
    0,
    0,
    'carbon',
    [
      { resource: 'titanium', weight: 1 },
      { resource: 'hydrogenium', weight: 1 },
    ],
    new SeededRng('finite-reserve-test'),
    { small: 1, medium: 0, large: 0, massive: 0 }
  );

  const total = asteroid.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
  const range = WORLD_CONFIG.ASTEROID_RESOURCE_AMOUNT.small;

  assert.ok(total >= range.min && total <= range.max);
  assert.ok(asteroid.veins.every((vein) => vein.remainingAmount > 0));
});

test('generates the same valid sector for the same seed', () => {
  const first = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const second = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  assert.deepEqual(first, second);

  const halfWidth = WORLD_CONFIG.SECTOR.WIDTH / 2;
  const halfHeight = WORLD_CONFIG.SECTOR.HEIGHT / 2;
  for (const asteroid of first.asteroids) {
    assert.ok(asteroid.x >= -halfWidth && asteroid.x < halfWidth);
    assert.ok(asteroid.y >= -halfHeight && asteroid.y < halfHeight);
    assert.ok(asteroid.veins.every((vein) => vein.remainingAmount > 0));
    const total = asteroid.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
    const range = WORLD_CONFIG.ASTEROID_RESOURCE_AMOUNT[asteroid.size];
    assert.ok(total >= range.min && total <= range.max);
  }

  for (let left = 0; left < first.asteroids.length; left += 1) {
    for (let right = left + 1; right < first.asteroids.length; right += 1) {
      const a = first.asteroids[left]!;
      const b = first.asteroids[right]!;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= WORLD_CONFIG.ASTEROID_MIN_DISTANCE);
    }
  }
});

test('only settlement sectors contain local player and bot slots', () => {
  const settlement = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const frontier = generateSector(1, 0, WORLD_CONFIG.WORLD_SEED, 'frontier');

  assert.equal(settlement.spawnSlots.length, WORLD_CONFIG.SECTOR.STATION_CAPACITY);
  assert.equal(
    settlement.spawnSlots.filter((slot) => slot.slotType === 'bot').length,
    WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT
  );
  assert.deepEqual(
    settlement.spawnSlots.map((slot) => slot.slotIndex),
    Array.from({ length: WORLD_CONFIG.SECTOR.STATION_CAPACITY }, (_, index) => index)
  );
  assert.equal(frontier.spawnSlots.length, 0);
});

test('settlement sectors are dense and mostly contain small asteroids', () => {
  const sector = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const smallCount = sector.asteroids.filter((asteroid) => asteroid.size === 'small').length;

  assert.ok(sector.asteroids.length >= 50);
  assert.ok(smallCount / sector.asteroids.length >= 0.6);
});

test('starter pocket is separate and guarantees all three core resources', () => {
  const sector = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const pocket = generateStarterPocket(sector.spawnSlots[0]!, sector.seed);
  assert.equal(pocket.length, 5);
  assert.deepEqual(pocket.map((asteroid) => asteroid.veins[0]!.resourceKey).sort(), [
    'carbon',
    'carbon',
    'hydrogenium',
    'titanium',
    'titanium',
  ]);
});

test('orthogonal sectors contain opposite rare resources without cross-contamination', () => {
  const even = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const odd = generateSector(1, 0, WORLD_CONFIG.WORLD_SEED, 'frontier');
  const resources = (sector: typeof even) =>
    new Set(sector.asteroids.flatMap((asteroid) => asteroid.veins.map((vein) => vein.resourceKey)));

  assert.equal(rareResourceForSector(0, 0), 'kyber_crystal');
  assert.equal(rareResourceForSector(1, 0), 'astatine');
  assert.equal(resources(even).has('kyber_crystal'), true);
  assert.equal(resources(even).has('astatine'), false);
  assert.equal(resources(odd).has('astatine'), true);
  assert.equal(resources(odd).has('kyber_crystal'), false);
});

test('initial rare fields do not contain massive primary deposits', () => {
  for (let sectorX = -1; sectorX <= 1; sectorX += 1) {
    for (let sectorY = -1; sectorY <= 1; sectorY += 1) {
      const role = sectorX === 0 && sectorY === 0 ? 'settlement' : 'frontier';
      const sector = generateSector(sectorX, sectorY, WORLD_CONFIG.WORLD_SEED, role);
      const rareResource = rareResourceForSector(sectorX, sectorY);
      const massiveRareDeposits = sector.asteroids.filter(
        (asteroid) => asteroid.size === 'massive' && asteroid.veins[0]!.resourceKey === rareResource
      );

      assert.equal(massiveRareDeposits.length, 0);
    }
  }
});

test('massive asteroids keep rare resources out of primary and secondary veins', () => {
  const massiveOnly = { small: 0, medium: 0, large: 0, massive: 1 };
  const pool: { resource: ResourceKey; weight: number }[] = [
    { resource: 'carbon', weight: 1 },
    { resource: 'titanium', weight: 1 },
    { resource: 'hydrogenium', weight: 1 },
    { resource: 'kyber_crystal', weight: 100 },
    { resource: 'astatine', weight: 100 },
  ];
  const asteroids = [
    buildAsteroid(0, 0, 'astatine', pool, new SeededRng('massive-rare-primary'), massiveOnly),
    buildAsteroid(0, 0, 'carbon', pool, new SeededRng('massive-rare-secondary'), massiveOnly),
  ];

  for (const asteroid of asteroids) {
    assert.equal(asteroid.size, 'massive');
    assert.ok(
      asteroid.veins
        .filter((vein) => vein.veinType !== 'trace')
        .every((vein) => !isRareResource(vein.resourceKey))
    );
  }
});

test('starter miners make frequent trips and deplete small asteroids quickly', () => {
  const mole = spacecrafts.find((spacecraft) => spacecraft.key === 'mole')!;
  const sector = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED, 'settlement');
  const pockets = sector.spawnSlots.flatMap((slot) =>
    generateStarterPocket(slot, sector.seed).map((asteroid) => ({ slot, asteroid }))
  );

  const cycles = pockets.map(({ slot, asteroid }) => {
    const remainingAmount = asteroid.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
    return {
      size: asteroid.size,
      estimate: calculateMiningCycle({
        distance: calcDistance(slot, asteroid),
        speed: mole.speed,
        miningRate: mole.miningRate,
        cargoCapacity: mole.cargo,
        minerCount: 3,
        remainingAmount,
      }),
    };
  });
  const travelMinutes = cycles.map(({ estimate }) => estimate.oneWayTravelHours * 60);
  const roundTripMinutes = cycles.map(({ estimate }) => estimate.roundTripHours * 60);
  const smallDepletionHours = cycles
    .filter(({ size }) => size === 'small')
    .map(({ estimate }) => estimate.estimatedDepletionHours);

  assert.ok(Math.min(...travelMinutes) >= 1.5);
  assert.ok(Math.max(...travelMinutes) <= 4.2);
  assert.ok(Math.min(...roundTripMinutes) >= 8);
  assert.ok(Math.max(...roundTripMinutes) <= 13.5);
  assert.ok(Math.min(...smallDepletionHours) >= 0.75);
  assert.ok(Math.max(...smallDepletionHours) <= 2.25);

  const totalReserve = [...sector.asteroids, ...pockets.map(({ asteroid }) => asteroid)].reduce(
    (sum, asteroid) =>
      sum + asteroid.veins.reduce((veinSum, vein) => veinSum + vein.remainingAmount, 0),
    0
  );
  const referenceDeliveryPerHour = calculateMiningCycle({
    distance: (mole.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR) / 12,
    speed: mole.speed,
    miningRate: mole.miningRate,
    cargoCapacity: mole.cargo,
    minerCount: 1,
    remainingAmount: 10_000,
  }).totalDeliveryPerHour;
  const fullSectorRunwayDays =
    totalReserve / (WORLD_CONFIG.SECTOR.STATION_CAPACITY * 3 * referenceDeliveryPerHour * 24);

  assert.ok(fullSectorRunwayDays >= 3);
  assert.ok(fullSectorRunwayDays <= 6);
});
