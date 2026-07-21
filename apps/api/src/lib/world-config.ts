export const WORLD_CONFIG = {
  CHUNK_SIZE: 1000,
  WORLD_SEED: 'orions-frontier-v6',
  INITIAL_SECTOR_RADIUS: 1,

  SECTOR: {
    WIDTH: 8_000,
    HEIGHT: 8_000,
    STATION_CAPACITY: 8,
    BOTS_PER_SETTLEMENT: 2,
    SAFE_SPAWN_RADIUS: 900,
  },

  ASTEROID_MIN_DISTANCE: 180,
  VEIN_COUNT: {
    small: { min: 1, max: 2 },
    medium: { min: 2, max: 2 },
    large: { min: 2, max: 3 },
    massive: { min: 3, max: 3 },
  },
  ASTEROID_RESOURCE_AMOUNT: {
    small: { min: 300, max: 600 },
    medium: { min: 1_500, max: 3_000 },
    large: { min: 8_000, max: 15_000 },
    massive: { min: 40_000, max: 80_000 },
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
  DISTRIBUTION: {
    settlement: { backgroundCount: 36, fieldCount: 2, asteroidsPerField: 12 },
    frontier: { backgroundCount: 30, fieldCount: 3, asteroidsPerField: 12 },
  },

  TRAVEL_SPEED_FACTOR: 80,

  STARTER_POCKET: {
    MIN_DIST: 300,
    MAX_DIST: 700,
    GUARANTEED: [
      { primaryResource: 'carbon', size: 'medium' },
      { primaryResource: 'titanium', size: 'medium' },
      { primaryResource: 'carbon', size: 'small' },
      { primaryResource: 'titanium', size: 'small' },
      { primaryResource: 'hydrogenium', size: 'small' },
    ],
  },
} as const;
