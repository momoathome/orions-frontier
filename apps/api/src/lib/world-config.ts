// ============================================================================
// World Config
// Single source of truth for all world-generation and gameplay constants.
// Change values here — never hardcode them in logic files.
// ============================================================================

import type { ResourceKey } from '@orions-frontier/shared';

// ── World Size ────────────────────────────────────────────────────────────────

export const WORLD_CONFIG = {
  /** Base world radius regardless of player count (world units) */
  BASE_RADIUS: 2000,
  /** Additional radius per player entity (human + AI) */
  RADIUS_PER_PLAYER: 600,
  /** Deterministic seed for world generation. Change = new world layout. */
  WORLD_SEED: 'orions-frontier-v1',

  // ── Zones (fraction of worldRadius) ────────────────────────────────────────

  /**
   * Center-out zone model:
   *  core      → massive/large, high hiddenLevel, contested
   *  midRing   → large/medium, semi-contested
   *  frontier  → medium/small, personal mining
   *  spawnRing → small/medium, safe starter resources
   */
  ZONES: {
    core: { min: 0.0, max: 0.15 },
    midRing: { min: 0.15, max: 0.45 },
    frontier: { min: 0.45, max: 0.75 },
    spawnRing: { min: 0.75, max: 1.0 },
  },

  // ── Asteroid density (asteroids per chunk, min–max) ───────────────────────

  ZONE_DENSITY: {
    core: { min: 2, max: 4 },
    midRing: { min: 3, max: 6 },
    frontier: { min: 4, max: 8 },
    spawnRing: { min: 6, max: 12 },
  },

  // ── Size weights per zone (unitless, higher = more likely) ───────────────

  ZONE_SIZE_WEIGHTS: {
    core: { small: 0, medium: 0, large: 40, massive: 60 },
    midRing: { small: 0, medium: 30, large: 60, massive: 10 },
    frontier: { small: 30, medium: 60, large: 10, massive: 0 },
    spawnRing: { small: 70, medium: 30, large: 0, massive: 0 },
  },

  // ── hiddenLevel range per zone ────────────────────────────────────────────
  //
  // min = always visible (even without scanner upgrades) — acts as a landmark
  // max = only visible with a high-tier scanner
  // SpawnRing is always fully visible (min/max both 0)

  ZONE_HIDDEN_LEVEL: {
    core: { min: 0, max: 4 },
    midRing: { min: 0, max: 2 },
    frontier: { min: 0, max: 1 },
    spawnRing: { min: 0, max: 0 },
  },

  // ── Vein count per asteroid size ─────────────────────────────────────────

  VEIN_COUNT: {
    small: { min: 1, max: 2 },
    medium: { min: 2, max: 2 },
    large: { min: 2, max: 3 },
    massive: { min: 3, max: 3 },
  },

  // ── Yield budget per hour per size (before modifiers) ────────────────────

  YIELD_BUDGET: {
    small: { min: 60, max: 120 },
    medium: { min: 180, max: 320 },
    large: { min: 600, max: 1100 },
    massive: { min: 2200, max: 5000 },
  },

  // ── Vein type modifier — fraction of budget this vein receives ───────────

  VEIN_MODIFIER: {
    primary: 0.7,
    secondary: 0.25,
    trace: 0.05,
  },

  // ── Resource tier (determines how rare and yield-limited a resource is) ───

  RESOURCE_TIER: {
    carbon: 'low_value',
    titanium: 'low_value',
    hydrogenium: 'medium_value',
    kyber_crystal: 'high_value',
    astatine: 'extreme_value',
  } as Record<ResourceKey, string>,

  // ── Yield modifier per tier (rarer = lower base yield) ───────────────────

  TIER_YIELD_MODIFIER: {
    low_value: 0.6,
    medium_value: 0.45,
    high_value: 0.15,
    extreme_value: 0.05,
  } as Record<string, number>,

  // ── Resource pools per zone (primary vein) ────────────────────────────────

  ZONE_PRIMARY_RESOURCES: {
    core: [
      { resource: 'kyber_crystal', weight: 40 },
      { resource: 'astatine', weight: 30 },
      { resource: 'hydrogenium', weight: 20 },
      { resource: 'titanium', weight: 10 },
    ],
    midRing: [
      { resource: 'hydrogenium', weight: 40 },
      { resource: 'titanium', weight: 30 },
      { resource: 'kyber_crystal', weight: 20 },
      { resource: 'carbon', weight: 10 },
    ],
    frontier: [
      { resource: 'titanium', weight: 40 },
      { resource: 'carbon', weight: 35 },
      { resource: 'hydrogenium', weight: 20 },
      { resource: 'kyber_crystal', weight: 5 },
    ],
    spawnRing: [
      { resource: 'carbon', weight: 60 },
      { resource: 'titanium', weight: 40 },
    ],
  } as Record<string, { resource: string; weight: number }[]>,

  // ── Secondary vein pools per zone ────────────────────────────────────────

  ZONE_SECONDARY_RESOURCES: {
    core: [
      { resource: 'hydrogenium', weight: 35 },
      { resource: 'kyber_crystal', weight: 30 },
      { resource: 'astatine', weight: 20 },
      { resource: 'titanium', weight: 15 },
    ],
    midRing: [
      { resource: 'titanium', weight: 40 },
      { resource: 'carbon', weight: 30 },
      { resource: 'hydrogenium', weight: 20 },
      { resource: 'kyber_crystal', weight: 10 },
    ],
    frontier: [
      { resource: 'carbon', weight: 50 },
      { resource: 'titanium', weight: 35 },
      { resource: 'hydrogenium', weight: 15 },
    ],
    spawnRing: [
      { resource: 'carbon', weight: 60 },
      { resource: 'titanium', weight: 40 },
    ],
  } as Record<string, { resource: string; weight: number }[]>,

  // ── Trace vein pools per zone (most diverse, prefer rare resources) ───────

  ZONE_TRACE_RESOURCES: {
    core: [
      { resource: 'astatine', weight: 40 },
      { resource: 'kyber_crystal', weight: 35 },
      { resource: 'hydrogenium', weight: 25 },
    ],
    midRing: [
      { resource: 'kyber_crystal', weight: 30 },
      { resource: 'hydrogenium', weight: 30 },
      { resource: 'astatine', weight: 25 },
      { resource: 'titanium', weight: 15 },
    ],
    frontier: [
      { resource: 'hydrogenium', weight: 40 },
      { resource: 'kyber_crystal', weight: 30 },
      { resource: 'carbon', weight: 20 },
      { resource: 'titanium', weight: 10 },
    ],
    spawnRing: [
      { resource: 'hydrogenium', weight: 60 },
      { resource: 'carbon', weight: 40 },
    ],
  } as Record<string, { resource: string; weight: number }[]>,

  // ── Purity system ─────────────────────────────────────────────────────────

  PURITY_TIERS: [
    { tier: 'impure', roll: [1, 30], multiplier: [0.4, 0.7] },
    { tier: 'normal', roll: [31, 75], multiplier: [0.9, 1.4] },
    { tier: 'rich', roll: [76, 93], multiplier: [1.5, 1.9] },
    { tier: 'pure', roll: [94, 99], multiplier: [2.0, 2.5] },
    { tier: 'pristine', roll: [100, 100], multiplier: [2.6, 3.0] },
  ] as { tier: string; roll: [number, number]; multiplier: [number, number] }[],

  // ── Stability ─────────────────────────────────────────────────────────────

  STABILITY_INITIAL: { min: 0.75, max: 1.0 },
  STABILITY_FLOOR: 0.1,
  /** Per-hour regen when mining load < yield */
  STABILITY_REGEN_PER_HOUR: 0.01,
  /** Base per-hour degradation at 1× overmining ratio */
  STABILITY_DEGRADATION_PER_HOUR: 0.05,

  // ── Mining slots per size ────────────────────────────────────────────────

  MINING_SLOTS: {
    small: 1,
    medium: 1,
    large: 2,
    massive: 2,
  } as Record<string, number>,

  // ── Spatial ───────────────────────────────────────────────────────────────

  /** Minimum distance between any two asteroids (world units) */
  ASTEROID_MIN_DISTANCE: 80,

  // ── Spawn slots ───────────────────────────────────────────────────────────
  //
  // One slot per player, evenly distributed on a circle inside the spawnRing.
  // No asteroids are placed within SAFE_RADIUS of any slot.

  SPAWN_CONFIG: {
    /** Fraction of worldRadius at which spawn slots are placed */
    RING_FRACTION: 0.88,
    /** No asteroid may be placed within this distance of a spawn slot (world units) */
    SAFE_RADIUS: 500,
  },
} as const;

export type ZoneType = keyof typeof WORLD_CONFIG.ZONES;
