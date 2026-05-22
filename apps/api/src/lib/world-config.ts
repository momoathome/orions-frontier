// ============================================================================
// World Config
// Single source of truth for all world-generation and gameplay constants.
// Change values here — never hardcode them in logic files.
// ============================================================================

import type { ResourceKey } from '@orions-frontier/shared';
import { VEIN_MODIFIER } from '@orions-frontier/shared';

// ── World Size ────────────────────────────────────────────────────────────────

export const WORLD_CONFIG = {
  /**
   * Size of each spatial chunk in world units.
   */
  CHUNK_SIZE: 1000,

  /** Base world radius regardless of player count (world units) */
  BASE_RADIUS: 5000,
  /** Additional radius per player entity (human + AI) */
  RADIUS_PER_PLAYER: 500,
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
    core: { min: 0.0, max: 0.1 },
    midRing: { min: 0.1, max: 0.4 },
    frontier: { min: 0.4, max: 0.7 },
    spawnRing: { min: 0.7, max: 1.0 },
  },

  // ── Asteroid density (asteroids per chunk, min–max) ───────────────────────

  ZONE_DENSITY: {
    core: { min: 1, max: 2 },
    midRing: { min: 1, max: 2 },
    frontier: { min: 1, max: 3 },
    spawnRing: { min: 2, max: 3 },
  },

  // ── Size weights per zone (unitless, higher = more likely) ───────────────

  ZONE_SIZE_WEIGHTS: {
    core: { small: 15, medium: 15, large: 30, massive: 40 },
    midRing: { small: 15, medium: 30, large: 50, massive: 5 },
    frontier: { small: 60, medium: 40, large: 0, massive: 0 },
    spawnRing: { small: 85, medium: 15, large: 0, massive: 0 },
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
    small: { min: 90, max: 120 },
    medium: { min: 180, max: 260 },
    large: { min: 380, max: 500 },
    massive: { min: 700, max: 1000 },
  },

  // ── Vein type modifier — fraction of budget this vein receives ───────────
  // Imported from @orions-frontier/shared — single source of truth for frontend + backend.

  VEIN_MODIFIER,

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
    low_value: 1,
    medium_value: 0.75,
    high_value: 0.2,
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
      { resource: 'titanium', weight: 35 },
      { resource: 'carbon', weight: 35 },
      { resource: 'hydrogenium', weight: 25 },
      { resource: 'kyber_crystal', weight: 5 },
    ],
    spawnRing: [
      { resource: 'carbon', weight: 40 },
      { resource: 'titanium', weight: 40 },
      { resource: 'hydrogenium', weight: 20 },
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
      { resource: 'carbon', weight: 45 },
      { resource: 'titanium', weight: 35 },
      { resource: 'hydrogenium', weight: 15 },
      { resource: 'kyber_crystal', weight: 5 },
    ],
    spawnRing: [
      { resource: 'carbon', weight: 40 },
      { resource: 'titanium', weight: 40 },
      { resource: 'hydrogenium', weight: 20 },
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
    { tier: 'impure', roll: [1, 30], multiplier: [0.5, 0.8] },
    { tier: 'normal', roll: [31, 75], multiplier: [0.9, 1.4] },
    { tier: 'rich', roll: [76, 93], multiplier: [1.5, 1.9] },
    { tier: 'pure', roll: [94, 99], multiplier: [2.0, 2.5] },
    { tier: 'pristine', roll: [100, 100], multiplier: [2.6, 3.0] },
  ] as { tier: string; roll: [number, number]; multiplier: [number, number] }[],

  // ── Stability ─────────────────────────────────────────────────────────────

  STABILITY_INITIAL: { min: 0.8, max: 1.0 },
  STABILITY_FLOOR: 0,
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
    SAFE_RADIUS: 200,
  },

  // ── Travel system ──────────────────────────────────────────────────────────
  //
  // Travel time formula: travelHours = distance / (speed × TRAVEL_SPEED_FACTOR)
  // With BASE_RADIUS=3500 and TRAVEL_SPEED_FACTOR=10:
  //   speed=50  Miner  → ~7h to cross the full world
  //   speed=70  Nomad  → ~5h
  //   speed=120 Fighter→ ~2.9h
  //   SpawnRing asteroids (≈3080 units from center) take proportionally less.

  // ── Game Speed (dev tuning) ───────────────────────────────────────────────
  //
  // Central knobs for adjusting the pace of the game during development.
  // All timing values reference these constants — change here, affects everything.
  //
  // Cheat sheet:
  //   TRAVEL_SPEED_FACTOR 10   → realistic (hours per trip)
  //   TRAVEL_SPEED_FACTOR 1000 → ~20× faster (minutes per trip)
  //
  //   MINING_RATE_MULTIPLIER 1   → normal
  //   MINING_RATE_MULTIPLIER 10  → 10× more resources per tick
  //
  //   MINING_TICK_INTERVAL_MS  300_000 → tick every 5 min (normal)
  //   MINING_TICK_INTERVAL_MS   10_000 → tick every 10 s (fast debug)
  //
  //   TRANSPORT_TICK_INTERVAL_MS  60_000 → check arrivals every 1 min (normal)
  //   TRANSPORT_TICK_INTERVAL_MS  10_000 → check every 10 s (fast debug)

  /** Multiplier: world-units per speed-unit per hour. Higher = faster travel. */
  TRAVEL_SPEED_FACTOR: 80,

  /** Global multiplier applied to all mined resource output. */
  MINING_RATE_MULTIPLIER: 1,

  /** How often the mining-tick BullMQ job runs (milliseconds). */
  MINING_TICK_INTERVAL_MS: 60_000,

  /** How often the transport-watchdog BullMQ job runs (milliseconds).
   * Primary arrivals are now handled by per-trip delayed jobs (Ticket B).
   * This watchdog only reconciles orphaned trips and runs infrequently. */
  TRANSPORT_TICK_INTERVAL_MS: 300_000, // 5 min watchdog

  // ── Transport dispatch scoring ────────────────────────────────────────────
  //
  // Controls how transporters are prioritised and dispatched.
  // Tune these values to change pickup aggressiveness without touching service code.

  TRANSPORT_DISPATCH: {
    /** Projected-fill fraction contribution to dispatch score ((buffer + rate × travelHours) / cargo) */
    W_FILL: 1.0,
    /** Normalised distance cost subtracted from score (distance / DISTANCE_REFERENCE × W_DISTANCE) */
    W_DISTANCE: 0.12,
    /** Max expected route distance used to normalise the distance penalty term */
    DISTANCE_REFERENCE: 2500,
    /** Ideal projected-fill ratio at arrival to qualify a transporter for a route (1.0 = full each trip) */
    TARGET_FILL: 0.9,
    /** Opportunistic fallback minimum projected fill when asteroid has been starved */
    SOFT_MIN_FILL: 0.65,
    /** How long (ms) an asteroid may go without a dispatch before fallback triggers */
    STARVATION_MS: 15 * 60 * 1000, // 15 minutes
  },
} as const;

export type ZoneType = keyof typeof WORLD_CONFIG.ZONES;
