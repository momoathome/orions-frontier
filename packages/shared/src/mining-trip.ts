export type MiningTripPhase = 'outbound' | 'mining' | 'returning';

export interface MiningTripTiming {
  purpose: string;
  departedAt: number;
  arrivesAt: number;
}

// The server stores mining as a 'mining_return' trip whose departure lies in the future.
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

/** Timestamp at which the current mining phase ends, or null outside a mining trip. */
export function getMiningTripPhaseEndsAt(trip: MiningTripTiming, now = Date.now()): number | null {
  const phase = getMiningTripPhase(trip, now);
  if (phase === null) return null;
  return phase === 'mining' ? trip.departedAt : trip.arrivesAt;
}

export interface MiningCycleTiming {
  oneWayTravelHours: number;
  miningRate: number;
  cargoCapacity: number;
  minerCount: number;
  remainingAmount: number;
}

export interface MiningCycleEstimate {
  oneWayTravelHours: number;
  miningHours: number;
  roundTripHours: number;
  deliveryPerHourPerMiner: number;
  totalDeliveryPerHour: number;
  estimatedDepletionHours: number;
  finalBatchAmount: number;
}

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0`);
  }
}

/** Estimate a repeating mining assignment for identical miners traveling as one group. */
export function estimateMiningCycle(input: MiningCycleTiming): MiningCycleEstimate {
  if (!Number.isFinite(input.oneWayTravelHours) || input.oneWayTravelHours < 0) {
    throw new RangeError('oneWayTravelHours must be a finite number greater than or equal to 0');
  }
  requirePositive(input.miningRate, 'miningRate');
  requirePositive(input.cargoCapacity, 'cargoCapacity');
  requirePositive(input.minerCount, 'minerCount');
  if (!Number.isInteger(input.minerCount)) {
    throw new RangeError('minerCount must be an integer');
  }
  if (!Number.isFinite(input.remainingAmount) || input.remainingAmount < 0) {
    throw new RangeError('remainingAmount must be a finite number greater than or equal to 0');
  }

  const { oneWayTravelHours } = input;
  const miningHours = input.cargoCapacity / input.miningRate;
  const roundTripHours = 2 * oneWayTravelHours + miningHours;
  const deliveryPerHourPerMiner = input.cargoCapacity / roundTripHours;
  const totalDeliveryPerHour = deliveryPerHourPerMiner * input.minerCount;
  const totalCargoCapacity = input.cargoCapacity * input.minerCount;
  const remainder = input.remainingAmount % totalCargoCapacity;

  return {
    oneWayTravelHours,
    miningHours,
    roundTripHours,
    deliveryPerHourPerMiner,
    totalDeliveryPerHour,
    estimatedDepletionHours:
      input.remainingAmount === 0 ? 0 : input.remainingAmount / totalDeliveryPerHour,
    finalBatchAmount:
      input.remainingAmount === 0
        ? 0
        : remainder || Math.min(input.remainingAmount, totalCargoCapacity),
  };
}
