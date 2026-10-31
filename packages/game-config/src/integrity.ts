const MAX_STATION_INTEGRITY = 100;
const REGENERATION_INTERVAL_MS = 60 * 60 * 1_000;

/** Stored integrity plus +1 per full hour since the last change, computed on read. */
export const currentIntegrity = (stored: number, updatedAt: Date, now: Date): number =>
  Math.min(
    MAX_STATION_INTEGRITY,
    stored +
      Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / REGENERATION_INTERVAL_MS))
  );

/** Damage of one won wave; no surviving bomber means no damage. */
export const integrityWaveDamage = (survivingBombers: number): number =>
  survivingBombers > 0 ? Math.min(35, 15 + 5 * survivingBombers) : 0;

/** What outsiders see: the upper bound of the quarter the integrity falls into. */
export const coarseIntegrity = (integrity: number): number =>
  integrity <= 0 ? 0 : Math.ceil(integrity / 25) * 25;
