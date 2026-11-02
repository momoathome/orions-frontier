import { getSpacecraft } from '@orions-frontier/game-config';
import type { CombatScouting } from '@orions-frontier/shared';

/** "Station defense 72, docked 3× Mole, 2× Merlin" from what surviving attackers saw. */
export function scoutingSummary(scouting: CombatScouting): string {
  const docked = Object.entries(scouting.dockedShips)
    .map(([key, amount]) => `${amount}× ${getSpacecraft(key)?.name ?? key}`)
    .join(', ');
  return `Station defense ${scouting.stationDefense}, ${docked ? `docked ${docked}` : 'no docked ships'}`;
}
