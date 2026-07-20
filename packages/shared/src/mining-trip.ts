export type MiningTripPhase = 'outbound' | 'mining' | 'returning';

export interface MiningTripTiming {
  purpose: string;
  departedAt: number;
  arrivesAt: number;
}

export function getMiningTripPhase(
  trip: MiningTripTiming,
  now = Date.now()
): MiningTripPhase | null {
  if (now >= trip.arrivesAt) return null;
  if (trip.purpose === 'mine') return now >= trip.departedAt ? 'outbound' : null;
  if (trip.purpose === 'mining_return') {
    return now < trip.departedAt ? 'mining' : 'returning';
  }
  return null;
}
