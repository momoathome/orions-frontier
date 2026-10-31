import {
  calculateConstructionSpeedBonus,
  durationFactor,
  isResearchKey,
  researchModifiers,
  type ResearchModifiers,
} from '@orions-frontier/game-config';
import type { ResearchLevels } from '@orions-frontier/shared';
import { getDb, type QueryDb } from '../../lib/db/index.js';
import { listStationOwnerResearch, listUserResearch } from './repositories/user-research.js';

export const toResearchLevels = (rows: { technologyKey: string; level: number }[]) => {
  const levels: ResearchLevels = {};
  for (const row of rows) {
    if (isResearchKey(row.technologyKey) && row.level > 0) levels[row.technologyKey] = row.level;
  }
  return levels;
};

export async function getResearchLevels(db: QueryDb, userId: string): Promise<ResearchLevels> {
  return toResearchLevels(await listUserResearch(db, userId));
}

export async function getResearchModifiers(userId: string, db: QueryDb = getDb()) {
  return researchModifiers(await getResearchLevels(db, userId));
}

/** Modifiers of the station's owner; research is account-wide. */
export async function getStationResearchModifiers(
  db: QueryDb,
  stationId: string
): Promise<ResearchModifiers> {
  return researchModifiers(toResearchLevels(await listStationOwnerResearch(db, stationId)));
}

/** Shortens a trip by Ion Propulsion: duration ÷ speed. */
export const applySpeed = (arrivesAt: Date, departedAt: Date, speed: number): Date =>
  new Date(departedAt.getTime() + Math.round((arrivesAt.getTime() - departedAt.getTime()) / speed));

/** `applySpeed` with the speed of the station's owner. */
export async function applyTravelSpeed(
  db: QueryDb,
  stationId: string,
  arrivesAt: Date,
  departedAt: Date
): Promise<Date> {
  return applySpeed(
    arrivesAt,
    departedAt,
    (await getStationResearchModifiers(db, stationId)).speed
  );
}

/** Duration factor of building and defense upgrades: Core and Construction Robotics add up. */
export const constructionFactor = (researchBonus: number, coreLevel: number) =>
  durationFactor(calculateConstructionSpeedBonus(coreLevel) + researchBonus);

/**
 * Returns the upgrade end with the Core's construction speed and Construction Robotics applied;
 * both percentages add up.
 */
export function applyConstructionSpeed(
  researchBonus: number,
  coreLevel: number,
  baseUpgradeEndsAt: Date,
  startsAt: Date
): Date {
  const factor = constructionFactor(researchBonus, coreLevel);
  const baseDuration = baseUpgradeEndsAt.getTime() - startsAt.getTime();
  return new Date(startsAt.getTime() + Math.round(baseDuration * factor));
}
