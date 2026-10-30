import type { AsteroidDetail, AsteroidDetailAssignment } from './asteroid.js';
import { estimateMiningCycle, type MiningCycleEstimate } from './mining-trip.js';
import { resourceKeys, type ResourceKey, type ResourceMap } from './resource.js';
import { isOneOf } from './type-guards.js';

export interface IncomeSource {
  asteroidId: string;
  primaryResourceKey: ResourceKey | null;
  miners: number;
  perHour: number;
  /** Empty while the composition is unknown. */
  byResource: { resourceKey: ResourceKey; perHour: number }[];
  /** At the yield of every station mining here; null without active miners. */
  depletionHours: number | null;
}

export interface IncomeArrival {
  tripId: string;
  asteroidId: string;
  arrivesAt: number;
  ships: string;
  cargo: { resourceKey: ResourceKey; amount: number }[];
}

export interface StationIncome {
  perHour: ResourceMap;
  /** Yield from asteroids whose composition is unknown. */
  unknownPerHour: number;
  inTransit: ResourceMap;
  arrivals: IncomeArrival[];
  sources: IncomeSource[];
}

export const activeMiners = (assignment: AsteroidDetailAssignment) =>
  assignment.assignedAmount - assignment.recallRequestedAmount;

/** Repeating cycle of one assignment, timed by its current trip leg; null when nothing is active. */
export function estimateAssignmentCycle(
  assignment: AsteroidDetailAssignment,
  remainingAmount: number
): MiningCycleEstimate | null {
  if (activeMiners(assignment) <= 0) return null;
  const trip = assignment.activeTrip;
  const oneWayTravelHours = trip
    ? Math.max(0, (Date.parse(trip.arrivesAt) - Date.parse(trip.departedAt)) / 3_600_000)
    : 0;
  return estimateMiningCycle({
    oneWayTravelHours,
    miningRate: assignment.spacecraftMiningRate,
    cargoCapacity: assignment.spacecraftCargo,
    minerCount: activeMiners(assignment),
    remainingAmount,
  });
}

const add = (rates: ResourceMap, key: ResourceKey, amount: number) => {
  rates[key] = (rates[key] ?? 0) + amount;
};

/**
 * Expected mining income of one station. Each cargo is split by remaining vein amounts
 * (see claimMiningCargo), so a vein yields its share of the asteroid's delivery rate.
 * `yieldFactor` is the owner's Deep Core Drilling: deliveries grow, the asteroid's loss does not.
 */
export function summarizeStationIncome(
  stationId: string,
  asteroids: readonly AsteroidDetail[],
  yieldFactor = 1
): StationIncome {
  const income: StationIncome = {
    perHour: {},
    unknownPerHour: 0,
    inTransit: {},
    arrivals: [],
    sources: [],
  };

  for (const asteroid of asteroids) {
    const remaining = asteroid.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
    const rate = (assignment: AsteroidDetailAssignment) =>
      estimateAssignmentCycle(assignment, remaining)?.totalDeliveryPerHour ?? 0;
    const own = asteroid.assignments.filter((assignment) => assignment.stationId === stationId);
    if (own.length === 0) continue;

    const perHour = own.reduce((sum, assignment) => sum + rate(assignment), 0) * yieldFactor;
    const allPerHour = asteroid.assignments.reduce((sum, assignment) => sum + rate(assignment), 0);
    const byResource =
      remaining > 0
        ? asteroid.veins.map((vein) => ({
            resourceKey: vein.resourceKey,
            perHour: (perHour * vein.remainingAmount) / remaining,
          }))
        : [];
    for (const entry of byResource) add(income.perHour, entry.resourceKey, entry.perHour);
    if (byResource.length === 0) income.unknownPerHour += perHour;

    const miners = own.reduce((sum, assignment) => sum + activeMiners(assignment), 0);
    // Fully recalled groups still bring their last cargo home but are no longer a source.
    if (miners > 0)
      income.sources.push({
        asteroidId: asteroid.id,
        primaryResourceKey:
          asteroid.veins.find((vein) => vein.veinType === 'primary')?.resourceKey ?? null,
        miners,
        perHour,
        byResource,
        depletionHours: allPerHour > 0 && remaining > 0 ? remaining / allPerHour : null,
      });

    for (const assignment of own) {
      const trip = assignment.activeTrip;
      if (trip?.purpose !== 'mining_return' || !trip.cargoManifest) continue;
      const cargo = Object.entries(trip.cargoManifest).flatMap(([resourceKey, amount]) =>
        isOneOf(resourceKeys, resourceKey) && amount > 0 ? [{ resourceKey, amount }] : []
      );
      for (const entry of cargo) add(income.inTransit, entry.resourceKey, entry.amount);
      income.arrivals.push({
        tripId: trip.id,
        asteroidId: asteroid.id,
        arrivesAt: Date.parse(trip.arrivesAt),
        ships: `${trip.groupSize}× ${assignment.spacecraftName}`,
        cargo,
      });
    }
  }

  income.arrivals.sort((a, b) => a.arrivesAt - b.arrivesAt);
  income.sources.sort((a, b) => b.perHour - a.perHour);
  return income;
}
