import { calcTravelHours } from './travel.js';

export interface MiningCycleInput {
  distance: number;
  speed: number;
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
export function calculateMiningCycle(input: MiningCycleInput): MiningCycleEstimate {
  requirePositive(input.miningRate, 'miningRate');
  requirePositive(input.cargoCapacity, 'cargoCapacity');
  requirePositive(input.minerCount, 'minerCount');
  if (!Number.isInteger(input.minerCount)) {
    throw new RangeError('minerCount must be an integer');
  }
  if (!Number.isFinite(input.remainingAmount) || input.remainingAmount < 0) {
    throw new RangeError('remainingAmount must be a finite number greater than or equal to 0');
  }

  const oneWayTravelHours = calcTravelHours(input.distance, input.speed);
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
