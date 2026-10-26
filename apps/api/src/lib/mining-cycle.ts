import { estimateMiningCycle, type MiningCycleEstimate } from '@orions-frontier/shared';
import { calcTravelHours } from './travel.js';

export type { MiningCycleEstimate } from '@orions-frontier/shared';

export interface MiningCycleInput {
  distance: number;
  speed: number;
  miningRate: number;
  cargoCapacity: number;
  minerCount: number;
  remainingAmount: number;
}

/** Server-side entry point: derives travel time from distance and speed, then uses the shared cycle rule. */
export function calculateMiningCycle(input: MiningCycleInput): MiningCycleEstimate {
  return estimateMiningCycle({
    oneWayTravelHours: calcTravelHours(input.distance, input.speed),
    miningRate: input.miningRate,
    cargoCapacity: input.cargoCapacity,
    minerCount: input.minerCount,
    remainingAmount: input.remainingAmount,
  });
}
