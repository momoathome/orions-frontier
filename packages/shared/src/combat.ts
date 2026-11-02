/** What surviving attackers saw at the target when the wave hit. */
export interface CombatScouting {
  /** Station defense the wave faced, with the defender's research. */
  stationDefense: number;
  /** Docked ships per spacecraft key before the battle. */
  dockedShips: Record<string, number>;
}

/** One side of a combat as the report names it. */
export interface CombatParty {
  userName: string;
  stationName: string;
  x: number;
  y: number;
}

export interface CombatReport {
  id: string;
  attackerStationId: string;
  defenderStationId: string;
  attackerUserId: string;
  defenderUserId: string;
  /** Sent fleet; null for the defender while the attack is still incoming. */
  attackerFleet: Record<string, number> | null;
  attackerAmount: number | null;
  /** Null for the defender until the battle, like the fleet. */
  attacker: CombatParty | null;
  defender: CombatParty;
  attackerLosses: number;
  defenderLosses: number;
  /** Destroyed ships per spacecraft key; null before the battle. */
  attackerShipLosses: Record<string, number> | null;
  /** Null before the battle, for older reports, and for an attacker whose wave was wiped out. */
  defenderShipLosses: Record<string, number> | null;
  winner: 'attacker' | 'defender' | null;
  loot: Record<string, number>;
  /** Integrity the wave removed and the defender's integrity afterwards. */
  integrityDamage: number;
  defenderIntegrity: number | null;
  stationDestroyed: boolean;
  /** Null without a battle; for the attacker also when no ship survived to report back. */
  scouting: CombatScouting | null;
  status: 'traveling' | 'returning' | 'resolved';
  /** Arrival of the attack at the defender. */
  arrivesAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

/** Before an attack: what the own scanner lets the server predict about the fight. */
export interface AttackForecast {
  /** Against the scanner's upper estimate of the target's station defense. */
  winChance: 'high' | 'medium' | 'low';
  /** Expected loot per resource if the attack wins, as a coarse range; empty if it loses. */
  loot: Record<string, { min: number; max: number }>;
  /** `last_report`: outside the scanner, from the user's newest combat report on the target. */
  basis: 'scanner' | 'last_report';
}
