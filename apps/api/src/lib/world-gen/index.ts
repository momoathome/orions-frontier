// ============================================================================
// world-gen/index.ts
// Public API — re-exports all symbols that consumers (e.g. seed.ts) depend on.
// ============================================================================

export type {
  AsteroidSize,
  VeinType,
  PurityTier,
  GeneratedVein,
  GeneratedAsteroid,
  GeneratedSpawnSlot,
  GeneratedPOI,
  GeneratedField,
  GeneratedSector,
} from './types.js';

export { SeededRng } from './rng.js';

export { worldToChunk, pickWeighted, rollPurity, pickSize, buildAsteroid, buildStarterAsteroid } from './asteroid-gen.js';

export { generateSector, generateSectors } from './sector-gen.js';
