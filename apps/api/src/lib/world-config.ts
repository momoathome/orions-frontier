export const WORLD_CONFIG = {
  CHUNK_SIZE: 1000,
  WORLD_SEED: 'orions-frontier-v5',
  INITIAL_SECTOR_RADIUS: 1,

  SECTOR: {
    WIDTH: 16_000,
    HEIGHT: 16_000,
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
    small: { min: 8_000, max: 12_000 },
    medium: { min: 20_000, max: 30_000 },
    large: { min: 50_000, max: 80_000 },
    massive: { min: 120_000, max: 200_000 },
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
  BACKGROUND_SIZE_WEIGHTS: { small: 60, medium: 40, large: 0, massive: 0 },
  FIELD_SIZE_WEIGHTS: { small: 15, medium: 40, large: 35, massive: 10 },
  DISTRIBUTION: {
    settlement: { backgroundCount: 24, fieldCount: 2, asteroidsPerField: 10 },
    frontier: { backgroundCount: 18, fieldCount: 3, asteroidsPerField: 11 },
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
