export { getUserCombatReports, handleCombatTripArrival, startAttack } from './combat.js';
export { handleRelocateArrival } from './destruction.js';
export {
  getDebrisById,
  getVisibleDebris,
  handleSalvageTripArrival,
  startSalvage,
} from './salvage.js';

// Reads and writes other modules may use; the tables stay owned by this module.
export { listUnresolvedCombatMissionsByUser } from './repositories/combat-missions.js';
export {
  listDebrisFieldsInChunks,
  listUnresolvedSalvageMissionsByUser,
} from './repositories/debris-fields.js';
