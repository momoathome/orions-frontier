export interface CombatReport {
  id: string;
  attackerStationId: string;
  defenderStationId: string;
  attackerUserId: string;
  defenderUserId: string;
  /** Sent fleet; null for the defender while the attack is still incoming. */
  attackerFleet: Record<string, number> | null;
  attackerAmount: number | null;
  attackerLosses: number;
  defenderLosses: number;
  winner: 'attacker' | 'defender' | null;
  loot: Record<string, number>;
  /** Integrity the wave removed and the defender's integrity afterwards. */
  integrityDamage: number;
  defenderIntegrity: number | null;
  stationDestroyed: boolean;
  status: 'traveling' | 'returning' | 'resolved';
  /** Arrival of the attack at the defender. */
  arrivesAt: string;
  createdAt: string;
  resolvedAt: string | null;
}
