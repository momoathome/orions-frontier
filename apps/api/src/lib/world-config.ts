// ============================================================================
// World Config
// Single source of truth for all world-generation and gameplay constants.
// Change values here — never hardcode them in logic files.
// ============================================================================

import { VEIN_MODIFIER } from '@orions-frontier/shared';

export const WORLD_CONFIG = {
  // ── Core ──────────────────────────────────────────────────────────────────

  /** Size of each spatial chunk in world units. */
  CHUNK_SIZE: 1000,

  /** Deterministic master seed. Change = entirely new world layout. */
  WORLD_SEED: 'orions-frontier-v4',

  // ── Asteroid composition ──────────────────────────────────────────────────

  /** Vein count range per asteroid size. */
  VEIN_COUNT: {
    small: { min: 1, max: 2 },
    medium: { min: 2, max: 2 },
    large: { min: 2, max: 3 },
    massive: { min: 3, max: 3 },
  },

  /** Finite total resource units generated per asteroid. */
  ASTEROID_RESOURCE_AMOUNT: {
    small: { min: 8_000, max: 12_000 },
    medium: { min: 20_000, max: 30_000 },
    large: { min: 50_000, max: 80_000 },
    massive: { min: 120_000, max: 200_000 },
  },

  /**
   * Fraction of the asteroid's budget each vein type receives.
   * Imported from @orions-frontier/shared — single source of truth for frontend + backend.
   */
  VEIN_MODIFIER,

  // ── Mining ────────────────────────────────────────────────────────────────

  /** Concurrent mining slots per asteroid size. */
  MINING_SLOTS: {
    small: 1,
    medium: 1,
    large: 2,
    massive: 2,
  } as Record<string, number>,

  /** Minimum distance between any two asteroids (world units). */
  ASTEROID_MIN_DISTANCE: 130,

  // ── Field generation ──────────────────────────────────────────────────────

  /**
   * Asteroid-count density factor per shape.
   * count = round(sqrt(fieldArea) * factor * rng(0.7–1.4))
   */
  FIELD_DENSITY_FACTOR: {
    straight_line: 0.06,
    arc: 0.05,
    snake: 0.04,
    crescent: 0.038,
    cloud: 0.04,
    dense_disk: 0.06,
  } as Record<string, number>,

  /** Fields with sampled-point count above this become mixed-resource. */
  FIELD_PURE_MAX: 20,

  /** Available field shapes — generator picks randomly per field. */
  FIELD_SHAPES: ['straight_line', 'arc', 'snake', 'crescent', 'cloud', 'dense_disk'] as const,

  // ── Sector ────────────────────────────────────────────────────────────────

  SECTOR: {
    WIDTH: 8000,
    HEIGHT: 8000,
    PLAYER_CAPACITY: 8,
    SAFE_SPAWN_RADIUS: 400,
    // Background count and field count are no longer static — they are derived
    // from the sector's rolled personality (see SECTOR_PERSONALITIES below).
  },

  /**
   * Sector personalities — rolled deterministically per sector from the world seed.
   *
   * Each personality controls:
   *   backgroundDensity  [min, max] fraction of the theoretical max asteroid count
   *                      to fill with background scatter.  The formula is:
   *                        netArea = W×H − slots×π×safeRadius²
   *                        count   = round(netArea / minDist² × rng(min, max))
   *   fieldCount         [min, max] number of distinct field clusters to generate.
   *   vastField          When true the single field is a giant dense_disk spanning
   *                      most of the sector, placed near sector centre.
   *
   * Weights are used by pickWeighted — higher weight = more common sector type.
   */
  SECTOR_PERSONALITIES: [
    {
      id: 'balanced',
      weight: 35,
      backgroundDensity: [0.003, 0.007] as [number, number],
      fieldCount: [2, 4] as [number, number],
      vastField: false,
    },
    {
      id: 'sparse',
      weight: 20,
      backgroundDensity: [0.001, 0.003] as [number, number],
      fieldCount: [1, 2] as [number, number],
      vastField: false,
    },
    {
      id: 'dense',
      weight: 15,
      backgroundDensity: [0.008, 0.014] as [number, number],
      fieldCount: [3, 5] as [number, number],
      vastField: false,
    },
    {
      id: 'field_heavy',
      weight: 20,
      backgroundDensity: [0.001, 0.003] as [number, number],
      fieldCount: [4, 6] as [number, number],
      vastField: false,
    },
    {
      id: 'vast_field',
      weight: 10,
      backgroundDensity: [0.0, 0.002] as [number, number],
      fieldCount: [1, 1] as [number, number],
      vastField: true,
    },
  ],

  /**
   * Resources used for background (sector-fill) asteroids.
   * Only the 3 core resources — every sector has them uniformly scattered.
   */
  BACKGROUND_RESOURCES: [
    { resource: 'carbon', weight: 40 },
    { resource: 'titanium', weight: 40 },
    { resource: 'hydrogenium', weight: 20 },
  ] as { resource: string; weight: number }[],

  /**
   * Resources that can be the primary resource of a generated field.
   * Higher-weight resources appear more often as field primaries.
   */
  FIELD_RESOURCES: [
    { resource: 'carbon', weight: 15 },
    { resource: 'titanium', weight: 15 },
    { resource: 'hydrogenium', weight: 20 },
    { resource: 'kyber_crystal', weight: 35 },
    { resource: 'astatine', weight: 15 },
  ] as { resource: string; weight: number }[],

  /** Global size distribution — used for starter pockets and as default fallback. */
  SIZE_WEIGHTS: { small: 50, medium: 35, large: 15, massive: 0 },

  /**
   * Size distribution for background (sector-fill) asteroids.
   * Background should feel unremarkable — small and medium only.
   */
  BACKGROUND_SIZE_WEIGHTS: { small: 60, medium: 40, large: 0, massive: 0 },

  /**
   * Size distribution for field cluster asteroids.
   * Fields are the exciting part of a sector — large and massive are common,
   * so players encounter visually impressive asteroids here.
   * Massive is intentionally rare enough to feel like a discovery.
   */
  FIELD_SIZE_WEIGHTS: { small: 20, medium: 40, large: 30, massive: 10 },

  // ── Game speed (dev tuning) ───────────────────────────────────────────────

  /** Multiplier: world-units per speed-unit per hour. Higher = faster travel. */
  TRAVEL_SPEED_FACTOR: 80,

  // ── Starter pockets ───────────────────────────────────────────────────────
  //
  // Guaranteed asteroid cluster generated around every spawn slot.
  // Uses a separate RNG stream (:starter) so it does not shift the main seed.

  STARTER_POCKET: {
    /** Minimum distance from the spawn point (world units). */
    MIN_DIST: 250,
    /** Maximum distance from the spawn point (world units). */
    MAX_DIST: 550,
    /** Guaranteed asteroids per spawn slot — each gets its own placement attempt. */
    GUARANTEED: [
      { primaryResource: 'carbon', size: 'medium' },
      { primaryResource: 'titanium', size: 'medium' },
      { primaryResource: 'carbon', size: 'small' },
      { primaryResource: 'titanium', size: 'small' },
    ] as { primaryResource: string; size: string }[],
  },
} as const;
