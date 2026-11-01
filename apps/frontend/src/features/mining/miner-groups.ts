import {
  activeMiners,
  getMiningTripPhase,
  getMiningTripPhaseEndsAt,
  type AsteroidDetail,
} from '@orions-frontier/shared';

export type Assignment = AsteroidDetail['assignments'][number];

/** Miners of one ship type from one station; also the shape RecallMinersForm takes as AssignmentGroup. */
export interface OperationGroup {
  key: string;
  stationId: string | null;
  spacecraftName: string;
  assignments: Assignment[];
  members: { id: string; availableAmount: number }[];
  totalAmount: number;
  activeAmount: number;
  recallRequestedAmount: number;
  isOwn: boolean;
}

export function groupAssignments(
  assignments: readonly Assignment[],
  ownStationId: string | null
): OperationGroup[] {
  const groups = new Map<string, OperationGroup>();
  for (const assignment of assignments) {
    const key = `${assignment.stationId}:${assignment.spacecraftKey}`;
    const group = groups.get(key) ?? {
      key,
      stationId: assignment.stationId,
      spacecraftName: assignment.spacecraftName,
      assignments: [],
      members: [],
      totalAmount: 0,
      activeAmount: 0,
      recallRequestedAmount: 0,
      isOwn: assignment.stationId === ownStationId,
    };
    group.assignments.push(assignment);
    group.members.push({ id: assignment.id, availableAmount: activeMiners(assignment) });
    group.totalAmount += assignment.assignedAmount;
    group.activeAmount += activeMiners(assignment);
    group.recallRequestedAmount += assignment.recallRequestedAmount;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const tripTiming = (trip: NonNullable<Assignment['activeTrip']>) => ({
  purpose: trip.purpose,
  departedAt: Date.parse(trip.departedAt),
  arrivesAt: Date.parse(trip.arrivesAt),
});

export function phaseLabel(assignment: Assignment, now: number): string {
  const trip = assignment.activeTrip;
  if (!trip) return 'WAITING';
  return getMiningTripPhase(tripTiming(trip), now)?.toUpperCase() ?? 'WAITING';
}

export function phaseDeadline(assignment: Assignment, now: number): number | null {
  const trip = assignment.activeTrip;
  return trip ? getMiningTripPhaseEndsAt(tripTiming(trip), now) : null;
}

export function phaseDescription(assignment: Assignment, now: number): string {
  switch (phaseLabel(assignment, now)) {
    case 'OUTBOUND':
      return 'Asteroid arrival';
    case 'MINING':
      return 'Return begins';
    case 'RETURNING':
      return 'Station arrival';
    default:
      return 'Awaiting next trip';
  }
}
