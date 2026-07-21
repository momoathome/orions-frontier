export interface CombatReport {
  id: string;
  attackerStationId: string;
  defenderStationId: string;
  attackerAmount: number;
  attackerLosses: number;
  defenderLosses: number;
  winner: 'attacker' | 'defender' | null;
  loot: Record<string, number>;
  status: 'traveling' | 'returning' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}
