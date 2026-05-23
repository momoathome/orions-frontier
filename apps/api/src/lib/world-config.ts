// ============================================================================
// World Config
// Single source of truth for all world-generation and gameplay constants.
// Change values here — never hardcode them in logic files.
// ============================================================================

import type { ResourceKey } from '@orions-frontier/shared';
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

  /** Yield budget range per hour per size (before modifiers). */
  YIELD_BUDGET: {
    small: { min: 90, max: 120 },
    medium: { min: 180, max: 260 },
    large: { min: 380, max: 500 },
    massive: { min: 700, max: 1000 },
  },

  /**
   * Fraction of the asteroid's budget each vein type receives.
   * Imported from @orions-frontier/shared — single source of truth for frontend + backend.
   */
  VEIN_MODIFIER,

  /** Resource scarcity tier — drives TIER_YIELD_MODIFIER lookup. */
  RESOURCE_TIER: {
    carbon: 'low_value',
    titanium: 'low_value',
    hydrogenium: 'medium_value',
    kyber_crystal: 'high_value',
    astatine: 'extreme_value',
  } as Record<ResourceKey, string>,

  /** Yield multiplier per scarcity tier (rarer = lower base yield). */
  TIER_YIELD_MODIFIER: {
    low_value: 1,
    medium_value: 0.75,
    high_value: 0.2,
    extreme_value: 0.05,
  } as Record<string, number>,

  // ── Purity ────────────────────────────────────────────────────────────────

  /** Purity tier multiplier ranges — roll a tier, then sample a float within it. */
  PURITY_TIERS: [
    { tier: 'impure', multiplier: [0.5, 0.8] },
    { tier: 'normal', multiplier: [0.9, 1.4] },
    { tier: 'rich', multiplier: [1.5, 1.9] },
    { tier: 'pure', multiplier: [2.0, 2.5] },
    { tier: 'pristine', multiplier: [2.6, 3.0] },
  ],

  /** Global probability weights per purity tier — applies to every asteroid. */
  PURITY_WEIGHTS: { impure: 20, normal: 50, rich: 20, pure: 8, pristine: 2 },

  // ── Stability ─────────────────────────────────────────────────────────────

  STABILITY_INITIAL: { min: 0.8, max: 1.0 },
  STABILITY_FLOOR: 0,
  /** Per-hour regen when mining load < yield. */
  STABILITY_REGEN_PER_HOUR: 0.01,
  /** Base per-hour degradation at 1× overmining ratio. */
  STABILITY_DEGRADATION_PER_HOUR: 0.05,

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
    arc: 0.050,
    snake: 0.04,
    crescent: 0.038,
    cloud: 0.040,
    dense_disk: 0.060,
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
    /** Sparse asteroids with core resources scattered across the whole sector. */
    BACKGROUND_COUNT: 150,
    /** Number of distinct field clusters per sector (inclusive). */
    MIN_FIELDS: 2,
    MAX_FIELDS: 3,
  },

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
  //
  // Cheat sheet:
  //   TRAVEL_SPEED_FACTOR 10   → realistic (hours per trip)
  //   TRAVEL_SPEED_FACTOR 1000 → ~20× faster (minutes per trip)
  //
  //   MINING_RATE_MULTIPLIER 1  → normal
  //   MINING_RATE_MULTIPLIER 10 → 10× more resources per tick
  //
  //   MINING_TICK_INTERVAL_MS  300_000 → tick every 5 min (normal)
  //   MINING_TICK_INTERVAL_MS   10_000 → tick every 10 s (fast debug)

  /** Multiplier: world-units per speed-unit per hour. Higher = faster travel. */
  TRAVEL_SPEED_FACTOR: 80,

  /** Global multiplier applied to all mined resource output. */
  MINING_RATE_MULTIPLIER: 1,

  /** How often the mining-tick BullMQ job runs (milliseconds). */
  MINING_TICK_INTERVAL_MS: 60_000,

  /**
   * How often the transport-watchdog BullMQ job runs (milliseconds).
   * Primary arrivals are handled by per-trip delayed jobs.
   * This watchdog only reconciles orphaned trips.
   */
  TRANSPORT_TICK_INTERVAL_MS: 300_000,

  // ── Transport dispatch scoring ────────────────────────────────────────────
  //
  // Controls how transporters are prioritised and dispatched.
  // Tune these to change pickup aggressiveness without touching service code.

  TRANSPORT_DISPATCH: {
    /** Projected-fill fraction contribution to dispatch score. */
    W_FILL: 1.0,
    /** Normalised distance cost subtracted from score. */
    W_DISTANCE: 0.12,
    /** Max expected route distance used to normalise the distance penalty. */
    DISTANCE_REFERENCE: 2500,
    /** Ideal projected-fill ratio at arrival to qualify a transporter for a route. */
    TARGET_FILL: 0.9,
    /** Opportunistic fallback minimum projected fill when asteroid has been starved. */
    SOFT_MIN_FILL: 0.65,
    /** How long (ms) an asteroid may go without a dispatch before fallback triggers. */
    STARVATION_MS: 15 * 60 * 1000,
  },

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
