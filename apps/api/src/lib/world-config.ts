export const WORLD_CONFIG = {
  CHUNK_SIZE: 1000,
  // Public default for development; production sets its own so maps cannot be precomputed.
  WORLD_SEED: process.env['WORLD_SEED'] ?? 'orions-frontier-v7',
  INITIAL_SECTOR_RADIUS: 1,

  SECTOR: {
    WIDTH: 6_000,
    HEIGHT: 6_000,
    STATION_CAPACITY: 8,
    BOTS_PER_SETTLEMENT: 2,
    SAFE_SPAWN_RADIUS: 650,
  },

  ASTEROID_MIN_DISTANCE: 140,
  VEIN_COUNT: {
    small: { min: 1, max: 2 },
    medium: { min: 2, max: 2 },
    large: { min: 2, max: 3 },
    massive: { min: 3, max: 3 },
  },
  ASTEROID_RESOURCE_AMOUNT: {
    small: { min: 2_700, max: 4_800 },
    medium: { min: 12_000, max: 21_000 },
    large: { min: 45_000, max: 84_000 },
    massive: { min: 240_000, max: 420_000 },
  },
  VEIN_WEIGHTS: { primary: 0.7, secondary: 0.25, trace: 0.05 },

  BACKGROUND_RESOURCES: [
    { resource: 'carbon', weight: 40 },
    { resource: 'titanium', weight: 40 },
    { resource: 'hydrogenium', weight: 20 },
  ] as const,
  FIELD_BASE_RESOURCES: [
    { resource: 'carbon', weight: 20 },
    { resource: 'titanium', weight: 20 },
    { resource: 'hydrogenium', weight: 20 },
  ] as const,
  BACKGROUND_SIZE_WEIGHTS: { small: 80, medium: 20, large: 0, massive: 0 },
  FIELD_SIZE_WEIGHTS: { small: 40, medium: 35, large: 20, massive: 5 },
  RARE_FIELD_SIZE_WEIGHTS: { small: 70, medium: 30, large: 0, massive: 0 },
  DISTRIBUTION: {
    settlement: { backgroundCount: 48, fieldCount: 3, asteroidsPerField: 12 },
    frontier: { backgroundCount: 40, fieldCount: 4, asteroidsPerField: 12 },
  },

  TRAVEL_SPEED_FACTOR: 80,

  STARTER_POCKET: {
    MIN_DIST: 180,
    MAX_DIST: 420,
    GUARANTEED: [
      { primaryResource: 'carbon', size: 'medium' },
      { primaryResource: 'titanium', size: 'medium' },
      { primaryResource: 'carbon', size: 'small' },
      { primaryResource: 'titanium', size: 'small' },
      { primaryResource: 'hydrogenium', size: 'small' },
    ],
  },
} as const;
