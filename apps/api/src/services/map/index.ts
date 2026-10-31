export {
  getUserRevealedAsteroidIds,
  isPointVisible,
  scannerChunkBounds,
  type ScannerCoverage,
  type VisibilityProjectionStats,
  visibleChunkBounds,
} from './scanner-visibility.js';
export { ensureSector, insertGeneratedAsteroids, openNextSettlementSector } from './sector.js';

// Reads and writes other modules may use; the tables stay owned by this module.
export {
  addAssignmentRecallRequest,
  deleteAsteroid,
  deleteAsteroidAssignment,
  deleteStationAssignments,
  findAssignmentRouteForUpdate,
  findAsteroidForUpdate,
  findVisibleAsteroid,
  hasAsteroidAssignments,
  insertAsteroidAssignment,
  listAsteroidAssignmentsByStations,
  listAsteroidAssignmentsWithOwner,
  listAsteroidPositionsInSector,
  listAsteroidSummariesInChunks,
  listAsteroidVeins,
  listAsteroidVeinsForUpdate,
  listAsteroidVeinsInChunks,
  listStationAssignmentsWithAsteroid,
  sumAsteroidRemainingAmount,
  updateAsteroidAssignment,
  updateAsteroidVeinRemaining,
} from './repositories/asteroids.js';
export {
  findSectorByCoordinates,
  findSettlementSector,
  isUnknownFrontierCoordinate,
  listBotSettlementSectorIds,
  listFrontierCoordinates,
  listNearestSectors,
} from './repositories/sectors.js';
export {
  assignSpawnSlot,
  findFreeSpawnSlotForUpdate,
  releaseSpawnSlots,
} from './repositories/spawn-slots.js';
