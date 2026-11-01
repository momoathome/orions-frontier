import { expect, test } from 'vitest';
import {
  groupAssignments,
  phaseLabel,
  type Assignment,
} from '../../src/features/mining/miner-groups';

const assignment = (overrides: Partial<Assignment>): Assignment => ({
  id: 'a1',
  stationId: 'own',
  spacecraftKey: 'miner',
  spacecraftName: 'Miner',
  spacecraftMiningRate: 1,
  spacecraftCargo: 10,
  assignedAmount: 4,
  assignedAt: '2026-01-01T00:00:00Z',
  recallRequestedAt: null,
  recallRequestedAmount: 0,
  activeTrip: null,
  ...overrides,
});

test('miners of one ship type from one station form one group, recalls count separately', () => {
  const groups = groupAssignments(
    [
      assignment({ id: 'a1' }),
      assignment({ id: 'a2', assignedAmount: 3, recallRequestedAmount: 1 }),
      assignment({ id: 'b1', stationId: null }),
    ],
    'own'
  );

  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({
    isOwn: true,
    totalAmount: 7,
    activeAmount: 6,
    recallRequestedAmount: 1,
    members: [
      { id: 'a1', availableAmount: 4 },
      { id: 'a2', availableAmount: 2 },
    ],
  });
  expect(groups[1]).toMatchObject({ isOwn: false, totalAmount: 4 });
});

test('a miner without a trip waits', () => {
  expect(phaseLabel(assignment({}), Date.now())).toBe('WAITING');
});
