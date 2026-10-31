import type { PlaytestPopulationMember } from '../../src/tools/playtest/population.js';

export function testPopulationMember(
  overrides: Partial<PlaytestPopulationMember> = {}
): PlaytestPopulationMember {
  return {
    alias: 'player-001',
    userId: '10000000-0000-4000-8000-000000000001',
    initialStationId: '20000000-0000-4000-8000-000000000001',
    profile: 'technocrat',
    joinedAt: new Date('2030-01-01T00:00:00.000Z'),
    populationKind: 'synthetic_player',
    ...overrides,
  };
}
